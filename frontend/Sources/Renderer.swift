import Foundation
import Metal
import MetalKit

/// Turning a 256x240 array of pixels into something on a screen.
///
/// The whole renderer is one texture, one full screen triangle and about
/// twenty lines of shader. That is not a shortcut: the NES produced a 256x240
/// image at 60 Hz and nothing else, so there is nothing else to do. The work
/// that makes a modern GPU earn its keep - lighting, geometry, post - has no
/// equivalent here, because the console already did all of it in 1979.
///
/// Two details matter more than they look:
///
///   * The sampler must be NEAREST, never linear. Every pixel here is
///     deliberate. Smoothing them turns pixel art into mush.
///
///   * The shader is compiled from a string at start up rather than from a
///     .metal file. That is not a hack for this environment: it means the
///     whole front end is three source files and no build step, and there is
///     no .metallib to keep in sync with the code.
final class Renderer: NSObject, MTKViewDelegate {

    private let device: MTLDevice
    private let queue: MTLCommandQueue
    private let pipeline: MTLRenderPipelineState
    private let sampler: MTLSamplerState
    private var texture: MTLTexture?

    /// Multiplier applied to the texture coordinates, NOT to the vertices.
    ///
    /// This distinction is the whole trick to fitting a 256x240 image into
    /// an arbitrary window. Squeezing the vertices is the obvious thing to
    /// do and it is wrong: the full screen triangle is only just big enough
    /// to cover the screen, so pulling its corners inward exposes the corner
    /// of the screen (a black triangle) and drags the texture along the
    /// diagonal. Leaving the vertices alone and stretching the coordinates
    /// instead keeps the triangle covering everything; anything outside the
    /// texture is painted black, which is the letterbox bar.
    private var uvScale = SIMD2<Float>(1, 1)

    /// The framebuffer from the core. Not copied, not converted: the texture
    /// is filled straight from this pointer every frame.
    var framebuffer: UnsafePointer<UInt32>?

    /// Called once at the start of every displayed frame, before the picture
    /// is uploaded.
    ///
    /// This is the emulator's clock. It runs at the display's refresh rate,
    /// which is what makes the window the thing that drives emulation: no
    /// timer, no thread, no drift between what is drawn and what is run.
    var onFrame: (() -> Void)?

    init?(device: MTLDevice) {
        guard let queue = device.makeCommandQueue() else { return nil }
        self.device = device
        self.queue = queue

        let source = """
        #include <metal_stdlib>
        using namespace metal;

        struct VertexOut {
            float4 position [[position]];
            float2 uv;
        };

        struct Uniforms {
            float2 uvScale;
        };

        // A single triangle that covers the screen. Two triangles would also
        // work; one is less to set up and has no seam down the diagonal.
        // The corners overshoot the screen so that it is fully covered no
        // matter how far the coordinates below are zoomed.
        vertex VertexOut vertex_main(uint vertex_id [[vertex_id]],
                                     constant Uniforms &uniforms [[buffer(0)]]) {
            const float2 corners[3] = { float2(-1.0, -1.0),
                                        float2( 3.0, -1.0),
                                        float2(-1.0,  3.0) };
            const float2 base_uv[3] = { float2(0.0, 1.0),
                                        float2(2.0, 1.0),
                                        float2(0.0, -1.0) };

            VertexOut out;
            out.position = float4(corners[vertex_id], 0.0, 1.0);
            // Zoom about the centre of the image (0.5, 0.5).
            out.uv = (base_uv[vertex_id] - 0.5) * uniforms.uvScale + 0.5;
            return out;
        }

        fragment float4 fragment_main(VertexOut in [[stage_in]],
                                      texture2d<float> screen [[texture(0)]],
                                      sampler nearest [[sampler(0)]]) {
            // Outside the texture is the letterbox: black, not a smeared
            // edge pixel, so clamp-to-edge sampling is never allowed to show
            // up. This is also what keeps a resized window honest.
            if (in.uv.x < 0.0 || in.uv.x > 1.0 ||
                in.uv.y < 0.0 || in.uv.y > 1.0) {
                return float4(0.0, 0.0, 0.0, 1.0);
            }
            return screen.sample(nearest, in.uv);
        }
        """

        do {
            let library = try device.makeLibrary(source: source, options: nil)

            let descriptor = MTLRenderPipelineDescriptor()
            descriptor.vertexFunction = library.makeFunction(name: "vertex_main")
            descriptor.fragmentFunction = library.makeFunction(name: "fragment_main")
            descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm

            pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
        } catch {
            FileHandle.standardError.write(
                "shader compilation failed: \(error)\n".data(using: .utf8)!)
            return nil
        }

        // Nearest, and clamp to edge. Linear filtering here would undo the
        // last forty years of pixel art.
        let samplerDescriptor = MTLSamplerDescriptor()
        samplerDescriptor.minFilter = .nearest
        samplerDescriptor.magFilter = .nearest
        samplerDescriptor.sAddressMode = .clampToEdge
        samplerDescriptor.tAddressMode = .clampToEdge
        guard let sampler = device.makeSamplerState(descriptor: samplerDescriptor) else {
            return nil
        }
        self.sampler = sampler

        super.init()

        makeTexture()
    }

    private func makeTexture() {
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm,
            width: Emulator.width,
            height: Emulator.height,
            mipmapped: false)
        descriptor.usage = [.shaderRead]
        descriptor.storageMode = .managed

        texture = device.makeTexture(descriptor: descriptor)
    }

    // MARK: - MTKViewDelegate

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
        updateScale(for: size)
    }

    func draw(in view: MTKView) {
        // Run the machine first, so what gets uploaded is the frame that was
        // just produced rather than the one before it.
        onFrame?()

        guard let texture,
              let framebuffer,
              let descriptor = view.currentRenderPassDescriptor,
              let drawable = view.currentDrawable,
              let commandBuffer = queue.makeCommandBuffer()
        else {
            return
        }

        updateScale(for: view.drawableSize)

        // The core hands over 256*240 uint32 values, 0x00RRGGBB, top row
        // first. In memory on a little endian machine that is B, G, R, 0,
        // which is exactly bgra8Unorm. So this is a straight copy with no
        // conversion at all.
        texture.replace(
            region: MTLRegionMake2D(0, 0, Emulator.width, Emulator.height),
            mipmapLevel: 0,
            withBytes: framebuffer,
            bytesPerRow: Emulator.width * MemoryLayout<UInt32>.size)

        guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor)
        else {
            return
        }

        var uniformValue = uvScale
        encoder.setRenderPipelineState(pipeline)
        encoder.setVertexBytes(&uniformValue,
                               length: MemoryLayout<SIMD2<Float>>.size,
                               index: 0)
        encoder.setFragmentTexture(texture, index: 0)
        encoder.setFragmentSamplerState(sampler, index: 0)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()

        commandBuffer.present(drawable)
        commandBuffer.commit()
    }

    /// Fit the image into the view without distorting it.
    ///
    /// A NES pixel is not square. The console outputs 256 pixels across a
    /// 4:3 screen, so each one is 8:7. Most emulators show it with square
    /// pixels anyway because that is what people remember; this fits either
    /// way and keeps the shape honest.
    private func updateScale(for size: CGSize) {
        let viewAspect = Float(size.width / max(size.height, 1))
        let imageAspect = Float(Emulator.width) / Float(Emulator.height)

        // The image keeps its shape: whichever axis has room to spare shows
        // a bar. The coordinate scale is the reciprocal of the fit scale,
        // because shrinking the image means zooming into the texture.
        if viewAspect > imageAspect {
            uvScale = SIMD2<Float>(viewAspect / imageAspect, 1)
        } else {
            uvScale = SIMD2<Float>(1, imageAspect / viewAspect)
        }
    }
}
