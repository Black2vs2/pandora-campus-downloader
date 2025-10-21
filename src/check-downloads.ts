import * as fs from "fs";
import * as path from "path";

interface TocItem {
  docbookId: string;
  title: string;
  pageNum: number;
}

interface Metadata {
  bookNumber: string;
  extractedAt: string;
  totalPages: number;
  tableOfContents: TocItem[];
}

interface DownloadStatus {
  docbookId: string;
  title: string;
  pageNum: number;
  status: "success" | "failed";
  fileName?: string;
  filePath?: string;
  fileExists: boolean;
  fileSize?: number;
}

interface OutputReport {
  bookNumber: string;
  checkedAt: string;
  totalPages: number;
  successCount: number;
  failedCount: number;
  downloadStatuses: DownloadStatus[];
  failedItems: TocItem[];
}

export function checkDownloadStatus(bookDir: string): OutputReport {
  // Read metadata.json
  const metadataPath = path.join(bookDir, "metadata.json");
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Metadata file not found: ${metadataPath}`);
  }

  const metadata: Metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  
  console.log(`Checking download status for book: ${metadata.bookNumber}`);
  console.log(`Expected pages: ${metadata.totalPages}`);

  const downloadStatuses: DownloadStatus[] = [];
  const failedItems: TocItem[] = [];

  // Check each expected file
  for (const tocItem of metadata.tableOfContents) {
    const fileName = `page_${tocItem.pageNum.toString().padStart(3, "0")}_${tocItem.docbookId.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
    const filePath = path.join(bookDir, fileName);
    const fileExists = fs.existsSync(filePath);
    
    let fileSize: number | undefined;
    if (fileExists) {
      try {
        const stats = fs.statSync(filePath);
        fileSize = stats.size;
      } catch (error) {
        console.warn(`Could not get file size for ${fileName}:`, error);
      }
    }

    const status: DownloadStatus = {
      docbookId: tocItem.docbookId,
      title: tocItem.title,
      pageNum: tocItem.pageNum,
      status: fileExists && (fileSize === undefined || fileSize > 1000) ? "success" : "failed", // Consider files < 1KB as failed
      fileName: fileName,
      filePath: filePath,
      fileExists: fileExists,
      fileSize: fileSize,
    };

    downloadStatuses.push(status);

    if (status.status === "failed") {
      failedItems.push(tocItem);
    }
  }

  const successCount = downloadStatuses.filter(s => s.status === "success").length;
  const failedCount = downloadStatuses.filter(s => s.status === "failed").length;

  const report: OutputReport = {
    bookNumber: metadata.bookNumber,
    checkedAt: new Date().toISOString(),
    totalPages: metadata.totalPages,
    successCount: successCount,
    failedCount: failedCount,
    downloadStatuses: downloadStatuses,
    failedItems: failedItems,
  };

  // Write output.json
  const outputPath = path.join(bookDir, "output.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`✓ Download status check complete:`);
  console.log(`  - Success: ${successCount}/${metadata.totalPages} pages`);
  console.log(`  - Failed: ${failedCount}/${metadata.totalPages} pages`);
  console.log(`  - Report saved: ${outputPath}`);

  if (failedCount > 0) {
    console.log(`\nFailed pages:`);
    failedItems.forEach(item => {
      console.log(`  - Page ${item.pageNum}: ${item.docbookId} - "${item.title}"`);
    });
  }

  return report;
}

export function getFailedItems(bookDir: string): TocItem[] {
  const outputPath = path.join(bookDir, "output.json");
  if (!fs.existsSync(outputPath)) {
    console.log("No output.json found, running check first...");
    const report = checkDownloadStatus(bookDir);
    return report.failedItems;
  }

  const report: OutputReport = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  return report.failedItems;
}

// CLI usage
if (require.main === module) {
  const bookDir = process.argv[2];
  if (!bookDir) {
    console.error("Usage: ts-node src/check-downloads.ts <book-directory>");
    console.error("Example: ts-node src/check-downloads.ts downloads/10_978_8815_415073");
    process.exit(1);
  }

  try {
    checkDownloadStatus(bookDir);
  } catch (error) {
    console.error("Error checking download status:", error);
    process.exit(1);
  }
}
