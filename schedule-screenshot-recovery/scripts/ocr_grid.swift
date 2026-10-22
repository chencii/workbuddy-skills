import Foundation
import Vision
import CoreGraphics
import ImageIO

// 网格逐格识别：命令行 ocrgrid <3x图像> <输出tsv> [scale]
// 输入为 3 倍放大、已转正的课表图。坐标按 1 倍像素定义，内部乘 3。
let args = CommandLine.arguments
let imgPath = args[1]
let outPath = args[2]
var scale = 2.0
if args.count > 3, let s = Double(args[3]) { scale = s }

guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: imgPath) as CFURL, nil),
      let base = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    FileHandle.standardError.write("cannot load image\n".data(using: .utf8)!)
    exit(1)
}
let F = 3.0  // 输入图相对 1 倍的倍数
let W = Double(base.width), H = Double(base.height)

// 列边界（1倍坐标）：0=行标签列，1..18=班级列，19=右端星期列
let cols: [Double] = [5,26,68,110,152,194,236,278,320,362,404,446,488,530,572,614,656,698,740,782,803]
// 每个区块的行边界（1倍坐标）
let blocks: [[Double]] = [
    [0,25,51,77,103,129,155,181,207,233,259,285,311],
    [345,371,397,423,449,475,501,527,553,579,605,631,657,683],
    [717,743,769,795,821,847,873,899,925,951,977,1003,1029,1055],
    [1089,1115,1141,1167,1193,1219,1245,1271,1297,1323,1349,1375,1401,1427],
    [1461,1487,1513,1539,1565,1591,1617,1643,1669,1695,1721,1747,1773,1799]
]
// 每个区块后的 34px 表头带
let bands: [[Double]] = [[311,345],[683,717],[1055,1089],[1427,1461],[1799,1833]]

let vocab = ["语文","数学","英语","物理","化学","生物","历史","政治","地理","体育","艺术","音乐","美术",
             "信息","通用","心理","自习","夜自习","改自习","班会","阅读","书法","劳动","校本","选修","综合","听力","微机","早读","大课间","测试","讲评","实验"]

func crop(_ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double) -> CGImage? {
    let r = CGRect(x: x0*F, y: y0*F, width: (x1-x0)*F, height: (y1-y0)*F).integral
    return base.cropping(to: r)
}

func upscale(_ img: CGImage, _ s: Double) -> CGImage {
    let w = Int(Double(img.width)*s), h = Int(Double(img.height)*s)
    guard let cs = CGColorSpace(name: CGColorSpace.sRGB) else { return img }
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                              space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return img }
    ctx.interpolationQuality = .high
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage() ?? img
}

func inkRatio(_ img: CGImage) -> Double {
    let w = img.width, h = img.height
    guard w > 0, h > 0 else { return 0 }
    var buf = [UInt8](repeating: 0, count: w*h*4)
    guard let cs = CGColorSpace(name: CGColorSpace.sRGB),
          let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w*4,
                              space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return 0 }
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    var dark = 0
    for i in stride(from: 0, to: w*h*4, by: 4) {
        let v = (Int(buf[i]) + Int(buf[i+1]) + Int(buf[i+2]))/3
        if v < 150 { dark += 1 }
    }
    return Double(dark)/Double(w*h)
}

func recognize(_ img: CGImage) -> (String, Float) {
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["zh-Hans"]
    req.usesLanguageCorrection = false
    req.minimumTextHeight = 0.01
    req.customWords = vocab
    do { try VNImageRequestHandler(cgImage: img, options: [:]).perform([req]) } catch { return ("", 0) }
    guard let obs = req.results?.first, let c = obs.topCandidates(1).first else { return ("", 0) }
    return (c.string, c.confidence)
}

var out: [String] = []
out.append("range\tblock\trow\tcol\tink\tconf\ttext")

// 列标签 + 班级列 + 右端列
for bi in 0..<blocks.count {
    let rows = blocks[bi]
    // 表头带（列号行）
    let bd = bands[bi]
    for ci in 0..<(cols.count-1) {
        if let c = crop(cols[ci]+1, bd[0]+2, cols[ci+1]-1, bd[1]-2) {
            let big = upscale(c, scale)
            let (t, cf) = recognize(big)
            out.append(String(format: "band\t%d\t-1\t%d\t%.3f\t%.2f\t%@", bi, ci, inkRatio(c), cf, t))
        }
    }
    for ri in 0..<(rows.count-1) {
        for ci in 0..<(cols.count-1) {
            if let c = crop(cols[ci]+1, rows[ri]+1, cols[ci+1]-1, rows[ri+1]-1) {
                let ink = inkRatio(c)
                let big = upscale(c, scale)
                let (t, cf) = recognize(big)
                out.append(String(format: "cell\t%d\t%d\t%d\t%.3f\t%.2f\t%@", bi, ri, ci, ink, cf, t))
            }
        }
    }
}
try out.joined(separator: "\n").write(toFile: outPath, atomically: true, encoding: .utf8)
print("cells written: \(out.count-1) -> \(outPath)")
