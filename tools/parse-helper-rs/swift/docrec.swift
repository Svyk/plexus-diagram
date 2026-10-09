import Foundation
import Vision

// macOS 26 RecognizeDocumentsRequest. Swift-only; the Rust helper shells out to this
// when probing whether Vision's document API returns table rows. Usage: docrec image.png

@main
struct DocRec {
    static func main() async {
        let args = CommandLine.arguments
        guard args.count >= 2 else {
            fputs("usage: docrec image.png\n", stderr)
            exit(2)
        }
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: args[1]))
            let request = RecognizeDocumentsRequest()
            let observations = try await request.perform(on: data)
            var tables: [[String: Any]] = []
            if let document = observations.first?.document {
                for table in document.tables {
                    var rows: [[String]] = []
                    for row in table.rows {
                        rows.append(row.map { cell in
                            cell.content.text.transcript
                        })
                    }
                    let cols = rows.map(\.count).max() ?? 0
                    tables.append([
                        "rows": rows.count,
                        "cols": cols,
                        "text": rows,
                    ])
                }
            }
            let payload: [String: Any] = [
                "tables": tables,
                "tableCount": tables.count,
                "observationCount": observations.count,
                "transcript": observations.first.map { $0.document.text.transcript } ?? "",
            ]
            let json = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            FileHandle.standardOutput.write(json)
            FileHandle.standardOutput.write(Data("\n".utf8))
        } catch {
            fputs("docrec: \(error)\n", stderr)
            exit(1)
        }
    }
}
