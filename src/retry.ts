import { retryFailedDownloads } from "./index";
import * as path from "path";
import * as fs from "fs";

// CLI usage for retry
const firstArg = process.argv[2];
const secondArg = process.argv[3];

if (!firstArg) {
  console.error(
    "Usage: ts-node src/retry.ts <book-id-or-directory-or-doi> [doi]"
  );
  console.error("Examples:");
  console.error("  ts-node src/retry.ts 10.978.8815.415073");
  console.error("  ts-node src/retry.ts downloads/10_978_8815_415073");
  console.error("  ts-node src/retry.ts doi/10.978.8815/415073");
  console.error(
    "  ts-node src/retry.ts downloads/10_978_8815_415073 doi/10.978.8815/415073"
  );
  process.exit(1);
}

let bookDir: string;
let bookId: string;
let useDoiFormat = false;

// Check if we have a DOI path in either first or second argument
const doiArg = firstArg.startsWith("doi/")
  ? firstArg
  : secondArg && secondArg.startsWith("doi/")
  ? secondArg
  : null;

// Extract book info from DOI if provided
if (doiArg) {
  const doiParts = doiArg.replace("doi/", "").replace(/\/$/, ""); // Remove trailing slash
  const pathSegments = doiParts.split("/");

  if (pathSegments.length >= 2) {
    useDoiFormat = true;
    console.log(
      `📖 DOI provided: ${doiArg} - will use slash format for book ID`
    );
  } else {
    console.error("❌ Invalid DOI format. Expected: doi/10.978.8815/415073");
    process.exit(1);
  }
}

// Handle the directory/book ID argument (the non-DOI argument)
const dirOrBookIdArg = doiArg === firstArg ? secondArg : firstArg;

if (!dirOrBookIdArg && doiArg) {
  // Only DOI provided, extract book ID and directory from DOI
  const doiParts = doiArg.replace("doi/", "").replace(/\/$/, "");
  bookId = doiParts; // Use the slash format directly
  const bookDirName = doiParts.replace(/[./]/g, "_");
  bookDir = path.join("downloads", bookDirName);

  console.log(`📁 Extracted from DOI:`);
  console.log(`  Book ID: ${bookId}`);
  console.log(`  Book directory: ${bookDir}`);
} else if (
  dirOrBookIdArg &&
  dirOrBookIdArg.includes(".") &&
  !dirOrBookIdArg.includes("/") &&
  !dirOrBookIdArg.includes("\\")
) {
  // It's a book ID
  bookId = dirOrBookIdArg;
  const bookDirName = bookId.replace(/\./g, "_");
  bookDir = path.join("downloads", bookDirName);

  console.log(`📚 Book ID: ${bookId}`);
  console.log(`📁 Book directory: ${bookDir}`);
} else if (dirOrBookIdArg) {
  // It's a directory path
  bookDir = dirOrBookIdArg;

  if (useDoiFormat && doiArg) {
    // Use DOI format when DOI is provided
    const doiParts = doiArg.replace("doi/", "").replace(/\/$/, "");
    bookId = doiParts;
    console.log(`📁 Book directory: ${bookDir}`);
    console.log(`📚 Book ID from DOI: ${bookId}`);
  } else {
    // Extract book ID from directory name
    const bookDirName = bookDir.split(/[/\\]/).pop() || "";
    bookId = bookDirName.replace(/_/g, ".");
    console.log(`📁 Book directory: ${bookDir}`);
    console.log(`📚 Inferred book ID: ${bookId}`);
  }
} else {
  console.error("❌ No valid directory or book ID provided");
  process.exit(1);
}

// Verify directory exists
if (!fs.existsSync(bookDir)) {
  console.error(`❌ Directory does not exist: ${bookDir}`);
  process.exit(1);
}

retryFailedDownloads(bookDir, bookId)
  .then(() => {
    console.log("✅ Retry process completed!");
  })
  .catch((error) => {
    console.error("❌ Retry process failed:", error);
    process.exit(1);
  });
