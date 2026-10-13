import * as fs from "fs";
import * as path from "path";
import { PDFDocument } from "pdf-lib";

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

interface Chapter {
  chapterNumber: number;
  title: string;
  startPage: number;
  endPage: number;
  pages: TocItem[];
}

export async function mergeChapterPDFs(bookDir: string): Promise<void> {
  console.log("Starting PDF chapter merging...");

  // Read metadata
  const metadataPath = path.join(bookDir, "metadata.json");
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Metadata file not found: ${metadataPath}`);
  }

  const metadata: Metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  console.log(`Processing book: ${metadata.bookNumber}`);
  console.log(`Total pages: ${metadata.totalPages}`);

  // Analyze table of contents to identify chapters
  const chapters = identifyChapters(metadata.tableOfContents);
  console.log(`Found ${chapters.length} chapters`);

  // Create processed directory
  const processedDir = path.join(bookDir, "processed");
  if (!fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir, { recursive: true });
  }

  // Merge PDFs for each chapter
  for (const chapter of chapters) {
    await mergeChapterPages(bookDir, processedDir, chapter);
  }

  // Merge every page into a single PDF for the whole book
  await mergeChapterPages(bookDir, processedDir, {
    chapterNumber: 0,
    title: "full_book",
    startPage: 1,
    endPage: metadata.tableOfContents.length,
    pages: metadata.tableOfContents,
  });

  console.log(`✓ Chapter merging completed! Files saved in: ${processedDir}`);
}

// Docbook IDs look like "_11_405": the first number identifies the chapter
// (document) the page belongs to, so it changes exactly at chapter boundaries
function getChapterKey(docbookId: string): string {
  const match = docbookId.match(/^_?(\d+)_/);
  return match ? match[1] : docbookId;
}

function identifyChapters(tocItems: TocItem[]): Chapter[] {
  const chapters: Chapter[] = [];
  let currentChapter: Chapter | null = null;
  let currentKey: string | null = null;
  let chapterNumber = 0;

  for (const item of tocItems) {
    const key = getChapterKey(item.docbookId);

    if (currentChapter && key === currentKey) {
      // Same document: section or sub-section of the current chapter
      currentChapter.pages.push(item);
      currentChapter.endPage = item.pageNum;
      continue;
    }

    // New document starts: numbered ones ("Capitolo 1 ...", "1 Introduzione")
    // are chapters, the rest (Premessa, Conclusioni, ...) are standalone parts
    const isChapter = /^(capitolo\s+)?\d+\s/i.test(item.title);
    if (isChapter) chapterNumber++;

    currentChapter = {
      chapterNumber: isChapter ? chapterNumber : 0,
      title: item.title,
      startPage: item.pageNum,
      endPage: item.pageNum,
      pages: [item],
    };
    currentKey = key;
    chapters.push(currentChapter);
  }

  return chapters;
}

async function mergeChapterPages(
  bookDir: string,
  processedDir: string,
  chapter: Chapter
): Promise<void> {
  console.log(
    `Merging Chapter ${chapter.chapterNumber}: "${chapter.title}" (${chapter.pages.length} pages)`
  );

  try {
    // Create a new PDF document
    const mergedPdf = await PDFDocument.create();

    // Add each page PDF to the merged document
    for (const page of chapter.pages) {
      const fileName = `page_${page.pageNum
        .toString()
        .padStart(3, "0")}_${page.docbookId.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
      const filePath = path.join(bookDir, fileName);

      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️ Missing file: ${fileName} - skipping`);
        continue;
      }

      try {
        // Read the PDF file
        const pdfBytes = fs.readFileSync(filePath);
        const pdf = await PDFDocument.load(pdfBytes);

        // Copy all pages from this PDF
        const pageIndices = pdf.getPageIndices();
        const copiedPages = await mergedPdf.copyPages(pdf, pageIndices);

        // Add copied pages to merged document
        copiedPages.forEach((page) => {
          mergedPdf.addPage(page);
        });

        console.log(`  ✓ Added: ${fileName}`);
      } catch (error) {
        console.error(`  ✗ Error processing ${fileName}:`, error);
      }
    }

    // Save the merged PDF
    let outputFileName: string;

    if (chapter.chapterNumber === 0) {
      // Standalone parts are named after their title (e.g. premessa.pdf)
      outputFileName = `${sanitizeFileName(chapter.title)}.pdf`;
    } else {
      // Generate descriptive filename for chapters
      const chapterTitle = sanitizeFileName(chapter.title);
      outputFileName = `chapter_${chapter.chapterNumber
        .toString()
        .padStart(2, "0")}_${chapterTitle}.pdf`;
    }

    const outputPath = path.join(processedDir, outputFileName);

    const pdfBytes = await mergedPdf.save();
    fs.writeFileSync(outputPath, pdfBytes);

    console.log(`✓ Saved merged chapter: ${outputFileName}`);
  } catch (error) {
    console.error(`✗ Error merging Chapter ${chapter.chapterNumber}:`, error);
  }
}

function sanitizeFileName(title: string): string {
  return (
    title
      // Handle Italian accented characters
      .replace(/[àáâãäå]/g, "a")
      .replace(/[èéêë]/g, "e")
      .replace(/[ìíîï]/g, "i")
      .replace(/[òóôõö]/g, "o")
      .replace(/[ùúûü]/g, "u")
      .replace(/[ç]/g, "c")
      .replace(/[ñ]/g, "n")
      // Handle apostrophes and quotes
      .replace(/[''`]/g, "")
      // Remove other special characters but keep basic punctuation
      .replace(/[^a-zA-Z0-9\s\-_.]/g, "")
      // Replace multiple spaces with single underscore
      .replace(/\s+/g, "_")
      // Remove leading/trailing underscores
      .replace(/^_+|_+$/g, "")
      .toLowerCase()
      .substring(0, 80)
  ); // Increased length limit for descriptive names
}

// CLI usage
if (require.main === module) {
  const bookDir = process.argv[2];
  if (!bookDir) {
    console.error("Usage: ts-node src/merge-chapters.ts <book-directory>");
    console.error(
      "Example: ts-node src/merge-chapters.ts downloads/10_978_8815_415073"
    );
    process.exit(1);
  }

  mergeChapterPDFs(bookDir)
    .then(() => {
      console.log("Chapter merging completed successfully!");
    })
    .catch((error) => {
      console.error("Error merging chapters:", error);
      process.exit(1);
    });
}
