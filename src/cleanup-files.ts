import * as fs from "fs";
import * as path from "path";

interface DownloadStatus {
  docbookId: string;
  title: string;
  pageNum: number;
  status: string;
  fileName: string;
  filePath: string;
  fileExists: boolean;
}

interface OutputData {
  bookNumber: string;
  downloadStatuses: DownloadStatus[];
}

interface MetadataItem {
  docbookId: string;
  title: string;
  pageNum: number;
}

interface MetadataData {
  bookNumber: string;
  tableOfContents: MetadataItem[];
}

function getExpectedFiles(bookDir: string): Set<string> {
  const expectedFiles = new Set<string>();

  // Always keep these metadata files
  expectedFiles.add("output.json");
  expectedFiles.add("metadata.json");

  try {
    // Try to read from output.json first (has more complete info)
    const outputPath = path.join(bookDir, "output.json");
    if (fs.existsSync(outputPath)) {
      const outputData: OutputData = JSON.parse(
        fs.readFileSync(outputPath, "utf8")
      );
      const downloadStatuses = outputData.downloadStatuses || [];

      downloadStatuses.forEach((status) => {
        if (status.fileName) {
          expectedFiles.add(status.fileName);
        }
      });

      console.log(
        `📖 Found ${downloadStatuses.length} expected files from output.json`
      );
    } else {
      // Fallback to metadata.json
      const metadataPath = path.join(bookDir, "metadata.json");
      if (fs.existsSync(metadataPath)) {
        const metadataData: MetadataData = JSON.parse(
          fs.readFileSync(metadataPath, "utf8")
        );
        const tableOfContents = metadataData.tableOfContents || [];

        tableOfContents.forEach((item) => {
          // Generate expected filename based on the pattern
          const fileName = `page_${item.pageNum
            .toString()
            .padStart(3, "0")}_${item.docbookId.replace(
            /[^a-zA-Z0-9]/g,
            "_"
          )}.pdf`;
          expectedFiles.add(fileName);
        });

        console.log(
          `📖 Generated ${tableOfContents.length} expected files from metadata.json`
        );
      } else {
        console.error("❌ No output.json or metadata.json found in directory");
        return expectedFiles;
      }
    }
  } catch (error) {
    console.error("❌ Error reading metadata files:", error);
  }

  return expectedFiles;
}

function cleanupDirectory(bookDir: string, dryRun: boolean = true): void {
  if (!fs.existsSync(bookDir)) {
    console.error(`❌ Directory does not exist: ${bookDir}`);
    return;
  }

  console.log(`🧹 ${dryRun ? "Analyzing" : "Cleaning"} directory: ${bookDir}`);
  console.log(
    `Mode: ${
      dryRun
        ? "DRY RUN (no files will be deleted)"
        : "LIVE MODE (files will be deleted)"
    }`
  );

  // Get expected files from metadata
  const expectedFiles = getExpectedFiles(bookDir);

  if (expectedFiles.size === 0) {
    console.log("⚠️ No expected files found, aborting cleanup");
    return;
  }

  // Get all files in directory
  const allFiles = fs.readdirSync(bookDir);
  const pdfFiles = allFiles.filter((file) => file.endsWith(".pdf"));

  console.log(
    `📁 Found ${allFiles.length} total files (${pdfFiles.length} PDF files)`
  );
  console.log(`✅ Expected ${expectedFiles.size} files (including metadata)`);

  // Find files to delete
  const filesToDelete: string[] = [];
  const filesToKeep: string[] = [];

  allFiles.forEach((file) => {
    if (expectedFiles.has(file)) {
      filesToKeep.push(file);
    } else {
      filesToDelete.push(file);
    }
  });

  // Report findings
  console.log(`\n📊 Analysis Results:`);
  console.log(`✅ Files to keep: ${filesToKeep.length}`);
  console.log(`❌ Files to delete: ${filesToDelete.length}`);

  if (filesToDelete.length > 0) {
    console.log(`\n🗑️ Files that will be deleted:`);
    filesToDelete.forEach((file) => {
      const filePath = path.join(bookDir, file);
      const stats = fs.statSync(filePath);
      const sizeKB = Math.round(stats.size / 1024);
      console.log(`  - ${file} (${sizeKB} KB)`);
    });

    if (!dryRun) {
      console.log(`\n🔥 Deleting ${filesToDelete.length} files...`);
      let deletedCount = 0;
      let errorCount = 0;

      filesToDelete.forEach((file) => {
        try {
          const filePath = path.join(bookDir, file);
          fs.unlinkSync(filePath);
          deletedCount++;
          console.log(`✅ Deleted: ${file}`);
        } catch (error) {
          errorCount++;
          console.error(`❌ Failed to delete ${file}:`, error);
        }
      });

      console.log(`\n📈 Cleanup Summary:`);
      console.log(`✅ Successfully deleted: ${deletedCount} files`);
      if (errorCount > 0) {
        console.log(`❌ Failed to delete: ${errorCount} files`);
      }
    } else {
      console.log(`\n💡 Run with --live flag to actually delete these files`);
    }
  } else {
    console.log(`\n🎉 Directory is clean! No files need to be deleted.`);
  }

  // Show some examples of kept files
  if (filesToKeep.length > 0) {
    console.log(`\n✅ Sample files being kept:`);
    filesToKeep.slice(0, 5).forEach((file) => {
      console.log(`  - ${file}`);
    });
    if (filesToKeep.length > 5) {
      console.log(`  ... and ${filesToKeep.length - 5} more`);
    }
  }
}

// CLI usage
const bookDir = process.argv[2];
const mode = process.argv[3];

if (!bookDir) {
  console.error(
    "Usage: ts-node src/cleanup-files.ts <book-directory> [--live]"
  );
  console.error("Examples:");
  console.error("  ts-node src/cleanup-files.ts downloads/10_978_8815_415073");
  console.error(
    "  ts-node src/cleanup-files.ts downloads/10_978_8815_415073 --live"
  );
  console.error("");
  console.error("Modes:");
  console.error("  (default) - Dry run mode, shows what would be deleted");
  console.error("  --live    - Actually deletes the files");
  process.exit(1);
}

const dryRun = mode !== "--live";

cleanupDirectory(bookDir, dryRun);
