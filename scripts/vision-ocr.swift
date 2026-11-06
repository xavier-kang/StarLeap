// vision-ocr — macOS Vision 框架中文 OCR 小工具
// 用法: vision-ocr image1.png [image2.png ...]
// 输出: 每张图一行 JSON: [{"text":"...","x":0.1,"y":0.2,"w":0.3,"h":0.1}]  (坐标为归一化值,原点左上)
import Foundation
import Vision
import AppKit

func ocr(path: String) throws -> String {
    guard let img = NSImage(contentsOfFile: path) else {
        return "[]"
    }
    var cg: CGImage? = nil
    if let tiff = img.tiffRepresentation, let src = CGImageSourceCreateWithData(tiff as CFData, nil) {
        cg = CGImageSourceCreateImageAtIndex(src, 0, nil)
    }
    guard let cgImage = cg else { return "[]" }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "zh-Hant"]
    request.usesLanguageCorrection = false

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])

    struct Box: Codable {
        let text: String
        let x: Double, y: Double, w: Double, h: Double
    }
    var boxes: [Box] = []
    for obs in request.results ?? [] {
        guard let candidate = obs.topCandidates(1).first else { continue }
        let bb = obs.boundingBox
        boxes.append(Box(text: candidate.string,
                         x: Double(bb.origin.x),
                         y: Double(1 - bb.origin.y - bb.height),
                         w: Double(bb.width),
                         h: Double(bb.height)))
    }
    // 按 y 再按 x 排序（阅读顺序）
    boxes.sort { a, b in
        if abs(a.y - b.y) > 0.02 { return a.y < b.y }
        return a.x < b.x
    }
    let data = try JSONSerialization.data(withJSONObject: boxes.map { ["text": $0.text, "x": $0.x, "y": $0.y, "w": $0.w, "h": $0.h] })
    return String(data: data, encoding: .utf8) ?? "[]"
}

var outputs: [String] = []
for path in CommandLine.arguments.dropFirst() {
    do { outputs.append(try ocr(path: path)) }
    catch { outputs.append("[]") }
}
print(outputs.joined(separator: "\n"))
