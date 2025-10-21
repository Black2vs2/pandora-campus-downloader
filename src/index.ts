import puppeteer from "puppeteer";
import { loginConfig } from "./config";
import * as fs from "fs";
import * as path from "path";
import { checkDownloadStatus, getFailedItems } from "./check-downloads";
import { mergeChapterPDFs } from "./merge-chapters";

async function loginToPandoraCampus(): Promise<{ browser: any; page: any }> {
  console.log("Starting Pandora Campus login automation...");

  // Launch browser
  const browser = await puppeteer.launch({
    headless: false, // Set to true if you want to run without GUI
    defaultViewport: null,
    args: ["--start-maximized"],
  });

  try {
    const page = await browser.newPage();

    // Navigate to Pandora Campus
    console.log("Navigating to https://www.pandoracampus.it/");
    await page.goto("https://www.pandoracampus.it/", {
      waitUntil: "domcontentloaded",
    });

    // Wait additional 2 seconds for content to fully load
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Click the Login button
    console.log("Clicking Login button...");
    // Look for login link or button
    const loginButton = await page.waitForFunction(
      () => {
        const elements = Array.from(document.querySelectorAll("a, button"));
        return elements.find(
          (el) =>
            el.textContent?.toLowerCase().includes("login") ||
            el.getAttribute("href")?.includes("login")
        );
      },
      { timeout: 10000 }
    );

    await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll("a, button"));
      const loginEl = elements.find(
        (el) =>
          el.textContent?.toLowerCase().includes("login") ||
          el.getAttribute("href")?.includes("login")
      );
      if (loginEl) (loginEl as HTMLElement).click();
    });

    // Wait for login form to appear
    await page.waitForSelector("#mainLogindialogjsonform-username", {
      timeout: 10000,
    });

    // Fill in email
    console.log("Filling in email...");
    const emailSelector = "#mainLogindialogjsonform-username";
    await page.waitForSelector(emailSelector);
    await page.click(emailSelector);
    await page.type(emailSelector, loginConfig.email);

    // Fill in password
    console.log("Filling in password...");
    const passwordSelector = "#mainLogindialogjsonform-password";
    await page.waitForSelector(passwordSelector);
    await page.click(passwordSelector);
    await page.type(passwordSelector, loginConfig.password);

    // Submit login form
    console.log("Submitting login form...");
    // Use the specific submit button ID
    await page.waitForSelector("#mainLogindialogjsonform-dorestlogin");
    await page.click("#mainLogindialogjsonform-dorestlogin");

    // Wait for navigation after login
    console.log("Waiting for login to complete...");
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 });

    console.log("Login completed successfully!");
    console.log("Current URL:", page.url());

    return { browser, page };
  } catch (error) {
    console.error("Error during login process:", error);
    await browser.close();
    throw error;
  }
}

async function navigateToMyBooksAndRead(
  page: any,
  specificDocbookIds?: string[]
): Promise<void> {
  try {
    console.log("Navigating to My Books page...");

    // Navigate to the mybooks page
    await page.goto("https://www.pandoracampus.it/pandora/mybooks", {
      waitUntil: "domcontentloaded",
    });

    // Wait additional 2 seconds for content to fully load
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log('Looking for first "Leggi" button...');

    // Wait for and click the first "Leggi" button
    const readButton = await page.waitForSelector("a.btn.read", {
      timeout: 15000,
    });
    if (readButton) {
      console.log('Found "Leggi" button, clicking...');
      await readButton.click();
    } else {
      throw new Error('Could not find any "Leggi" button');
    }

    console.log("Waiting for reader page to load...");

    // Wait for the reader-main-loader to have class "hide"
    await page.waitForFunction(
      () => {
        const loader = document.querySelector("#reader-main-loader");
        return loader && loader.classList.contains("hide");
      },
      { timeout: 30000 }
    );

    console.log("Reader loaded successfully, waiting 3 seconds...");

    // Wait 3 seconds as requested
    await new Promise((resolve) => setTimeout(resolve, 3000));

    console.log("Extracting docbook IDs...");

    let bookData;

    if (specificDocbookIds && specificDocbookIds.length > 0) {
      // Use provided docbook IDs (for retry functionality)
      console.log(
        `Using provided docbook IDs: ${specificDocbookIds.length} items`
      );

      const tocItems = specificDocbookIds.map((docbookId, index) => ({
        docbookId: docbookId,
        title: `Retry Page ${index + 1}`, // Simple title for retry
        pageNum: index + 1,
      }));

      bookData = {
        docbookIds: specificDocbookIds,
        tocItems: tocItems,
      };
    } else {
      // Extract docbook IDs and table of contents metadata from page
      bookData = await page.evaluate(() => {
        const elements = Array.from(
          document.querySelectorAll("[data-docbookid]")
        );

        const tocItems = elements.map((element, index) => {
          const docbookId = element.getAttribute("data-docbookid");
          const labelElement = element.querySelector(".Label");
          const titleElement = element.querySelector(".Title");

          let title = "";
          if (labelElement && titleElement) {
            // Both label and title present
            title = `${labelElement.textContent?.trim()} ${titleElement.textContent?.trim()}`;
          } else if (titleElement) {
            // Only title present
            title = titleElement.textContent?.trim() || "";
          } else {
            // Fallback to element text content
            title = element.textContent?.trim() || `Chapter ${index + 1}`;
          }

          return {
            docbookId: docbookId,
            title: title,
            pageNum: index + 1,
          };
        });

        return {
          docbookIds: elements.map((el) => el.getAttribute("data-docbookid")),
          tocItems: tocItems,
        };
      });
    }

    console.log("Docbook IDs found:", bookData.docbookIds);
    console.log("Total docbook elements:", bookData.docbookIds.length);
    console.log(
      "Table of contents extracted:",
      bookData.tocItems.length,
      "items"
    );

    // Download all pages as PDF
    if (bookData.docbookIds.length > 0) {
      await downloadPagesAsPDF(page, bookData.tocItems);
    }

    return bookData;

    // Keep browser open for a few seconds to see the result
    await new Promise((resolve) => setTimeout(resolve, 5000));
  } catch (error) {
    console.error("Error during books navigation and reading:", error);
    throw error;
  }
}

export async function downloadPagesAsPDF(
  page: any,
  tocItems: Array<{ docbookId: string; title: string; pageNum: number }>,
  bookNumber?: string
): Promise<void> {
  try {
    console.log("Starting PDF download process...");

    // Use provided book number or extract from current URL
    let finalBookNumber: string;

    if (bookNumber) {
      finalBookNumber = bookNumber;
      console.log("Using provided book number:", finalBookNumber);
    } else {
      // Extract the book number from current URL
      const currentUrl = page.url();
      console.log("Current URL:", currentUrl);

      // Extract book number from URL pattern like: /doi/10.978.8815/415073/_11_9
      const urlMatch = currentUrl.match(/\/doi\/([\d\.]+\/[\d]+)\//);
      if (!urlMatch) {
        throw new Error("Could not extract book number from URL");
      }

      finalBookNumber = urlMatch[1]; // e.g., "10.978.8815/415073"
      console.log("Extracted book number:", finalBookNumber);
    }

    // Create book-specific directory
    const bookFolderName = finalBookNumber.replace(/[^a-zA-Z0-9]/g, "_");
    const bookDir = path.join(process.cwd(), "downloads", bookFolderName);
    if (!fs.existsSync(bookDir)) {
      fs.mkdirSync(bookDir, { recursive: true });
    }

    // Generate metadata file
    const metadataPath = path.join(bookDir, "metadata.json");
    const metadata = {
      bookNumber: bookNumber,
      extractedAt: new Date().toISOString(),
      totalPages: tocItems.length,
      tableOfContents: tocItems,
    };

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
    console.log(`✓ Generated metadata file: metadata.json`);

    // Download first page sequentially to ensure everything works
    console.log("Downloading first page sequentially...");
    await downloadSinglePage(page, tocItems[0], bookDir, finalBookNumber);

    // If there are more pages, download them concurrently in batches
    if (tocItems.length > 1) {
      console.log(
        `Starting concurrent download of remaining ${
          tocItems.length - 1
        } pages...`
      );
      await downloadPagesInBatches(
        page.browser(),
        tocItems.slice(1),
        bookDir,
        finalBookNumber
      );
    }

    console.log(`PDF download completed! Files saved in: ${bookDir}`);

    // Automatically merge chapters after successful download
    console.log("Starting automatic chapter merging...");
    try {
      await mergeChapterPDFs(bookDir);
      console.log("✓ Chapter merging completed automatically!");
    } catch (error) {
      console.error("✗ Error during automatic chapter merging:", error);
      console.log(
        "You can run chapter merging manually later with: npm run merge " +
          bookDir
      );
    }
  } catch (error) {
    console.error("Error during PDF download process:", error);
    throw error;
  }
}

export async function downloadSinglePage(
  page: any,
  tocItem: { docbookId: string; title: string; pageNum: number },
  bookDir: string,
  bookNumber: string
): Promise<void> {
  const pageUrl = `https://www.pandoracampus.it/doi/${bookNumber}/${tocItem.docbookId}`;

  console.log(
    `Downloading page ${tocItem.pageNum}/${tocItem.pageNum}: ${tocItem.docbookId} - "${tocItem.title}"`
  );

  try {
    // Navigate to the page
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait additional 3 seconds for content to fully load
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Wait for the selectable area to load
    await page.waitForSelector("#selectableArea", { timeout: 15000 });

    // Wait a bit for content to fully render
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Extract content and generate PDF
    await extractAndGeneratePDF(page, tocItem, bookDir);

    console.log(
      `✓ Saved clean PDF: page_${tocItem.pageNum
        .toString()
        .padStart(3, "0")}_${tocItem.docbookId.replace(
        /[^a-zA-Z0-9]/g,
        "_"
      )}.pdf`
    );
  } catch (error) {
    console.error(`✗ Error downloading page ${tocItem.docbookId}:`, error);
    throw error;
  }
}

export async function downloadPagesInBatches(
  browser: any,
  tocItems: Array<{ docbookId: string; title: string; pageNum: number }>,
  bookDir: string,
  bookNumber: string
): Promise<void> {
  const batchSize = 10;

  for (let i = 0; i < tocItems.length; i += batchSize) {
    const batch = tocItems.slice(i, i + batchSize);
    console.log(
      `Processing batch ${Math.floor(i / batchSize) + 1}: pages ${
        batch[0].pageNum
      }-${batch[batch.length - 1].pageNum}`
    );

    // Create promises for concurrent downloads
    const downloadPromises = batch.map(async (tocItem) => {
      const newPage = await browser.newPage();
      try {
        await downloadSinglePageWithNewPage(
          newPage,
          tocItem,
          bookDir,
          bookNumber
        );
      } finally {
        await newPage.close();
      }
    });

    // Wait for all downloads in this batch to complete
    await Promise.allSettled(downloadPromises);

    // Small delay between batches
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function downloadSinglePageWithNewPage(
  page: any,
  tocItem: { docbookId: string; title: string; pageNum: number },
  bookDir: string,
  bookNumber: string
): Promise<void> {
  const pageUrl = `https://www.pandoracampus.it/doi/${bookNumber}/${tocItem.docbookId}`;

  console.log(
    `📄 [Concurrent] Downloading page ${tocItem.pageNum}: ${tocItem.docbookId} - "${tocItem.title}"`
  );

  try {
    // Navigate to the page
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait additional 3 seconds for content to fully load
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Wait for the selectable area to load
    await page.waitForSelector("#selectableArea", { timeout: 15000 });

    // Wait a bit for content to fully render
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Extract content and generate PDF
    await extractAndGeneratePDF(page, tocItem, bookDir);

    console.log(
      `✓ [Concurrent] Saved: page_${tocItem.pageNum
        .toString()
        .padStart(3, "0")}_${tocItem.docbookId.replace(
        /[^a-zA-Z0-9]/g,
        "_"
      )}.pdf`
    );
  } catch (error) {
    console.error(
      `✗ [Concurrent] Error downloading page ${tocItem.docbookId}:`,
      error
    );
  }
}

async function extractAndGeneratePDF(
  page: any,
  tocItem: { docbookId: string; title: string; pageNum: number },
  bookDir: string
): Promise<void> {
  // Extract the selectableArea element's HTML and styles
  const elementData = await page.evaluate(() => {
    const element = document.querySelector("#selectableArea");
    if (!element) return null;

    // Get all stylesheets from the page
    const stylesheets = Array.from(document.styleSheets);
    let allStyles = "";

    stylesheets.forEach((stylesheet) => {
      try {
        const rules = Array.from(stylesheet.cssRules || []);
        rules.forEach((rule) => {
          allStyles += rule.cssText + "\n";
        });
      } catch (e) {
        // Skip stylesheets that can't be accessed (CORS)
        console.log("Skipped stylesheet due to CORS");
      }
    });

    // Also get inline styles
    const styleElements = Array.from(document.querySelectorAll("style"));
    styleElements.forEach((style) => {
      allStyles += style.textContent + "\n";
    });

    // Get essential computed styles for the main element only
    const getEssentialStyles = (el: Element): string => {
      const computedStyle = window.getComputedStyle(el);
      const essentialProps = [
        "font-family",
        "font-size",
        "font-weight",
        "font-style",
        "line-height",
        "color",
        "text-align",
        "text-decoration",
        "margin",
        "margin-top",
        "margin-right",
        "margin-bottom",
        "margin-left",
        "padding",
        "padding-top",
        "padding-right",
        "padding-bottom",
        "padding-left",
        "background-color",
        "background",
        "border",
        "border-radius",
        "width",
        "max-width",
        "min-width",
        "height",
        "max-height",
        "min-height",
        "display",
        "position",
        "top",
        "right",
        "bottom",
        "left",
        "z-index",
        "overflow",
        "text-indent",
        "letter-spacing",
        "word-spacing",
      ];

      let cssRule = `#selectableArea {\n`;
      essentialProps.forEach((prop) => {
        const value = computedStyle.getPropertyValue(prop);
        if (
          value &&
          value !== "initial" &&
          value !== "normal" &&
          value !== "auto"
        ) {
          cssRule += `  ${prop}: ${value} !important;\n`;
        }
      });
      cssRule += "}\n\n";

      return cssRule;
    };

    // Get only essential computed styles to avoid conflicts
    const computedStyles = getEssentialStyles(element);

    return {
      html: element.outerHTML,
      styles: allStyles,
      computedStyles: computedStyles,
      title: document.title || "Pandora Campus Page",
    };
  });

  if (!elementData) {
    throw new Error(
      `Could not find #selectableArea on page ${tocItem.docbookId}`
    );
  }

  const fileName = `page_${tocItem.pageNum
    .toString()
    .padStart(3, "0")}_${tocItem.docbookId.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
  const filePath = path.join(bookDir, fileName);

  // Create a new page with just the extracted content
  const newPage = await page.browser().newPage();

  const cleanHTML = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>${elementData.title}</title>
        <style>
          /* Reset styles */
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          
          html, body {
            margin: 0;
            padding: 0;
            background: white;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
          }
          
          body {
            padding: 20px;
            line-height: 1.6;
            color: #333;
          }
          
          /* Original stylesheets from the page */
          ${elementData.styles}
          
          /* Essential computed styles for the main element */
          ${elementData.computedStyles}
          
          /* Ensure content is properly displayed */
          #selectableArea {
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            position: relative !important;
            clear: both !important;
            overflow: visible !important;
          }
          
          /* Fix common text rendering issues */
          #selectableArea p, 
          #selectableArea div, 
          #selectableArea span {
            position: relative !important;
            float: none !important;
            clear: both !important;
            display: block !important;
          }
          
          #selectableArea span {
            display: inline !important;
          }
          
          /* Hide overlays */
          [class*="overlay"],
          [class*="modal"],
          [class*="popup"],
          [id*="overlay"],
          [id*="modal"],
          [id*="popup"],
          [class*="cookie"],
          [id*="cookie"] {
            display: none !important;
          }
          
          /* Hide post-it notes and glosses */
          .mask,
          .glossa,
          [class*="mask"],
          [class*="glossa"],
          [id*="mask-"],
          [id*="complement-"] {
            display: none !important;
            visibility: hidden !important;
          }
          
          /* Force colors and backgrounds in print/PDF */
          * {
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          
          /* Print optimization */
          @media print {
            body { margin: 0; padding: 10px; }
            * { 
              -webkit-print-color-adjust: exact !important;
              color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            
            /* Force background colors in print */
            [style*="background"],
            [class*="bg-"],
            [id*="bg-"] {
              -webkit-print-color-adjust: exact !important;
              color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          }
        </style>
      </head>
      <body>
        ${elementData.html}
      </body>
    </html>
  `;

  await newPage.setContent(cleanHTML, { waitUntil: "networkidle0" });

  // Generate PDF from the clean page
  await newPage.pdf({
    path: filePath,
    format: "A4",
    printBackground: true,
    margin: {
      top: "1cm",
      right: "1cm",
      bottom: "1cm",
      left: "1cm",
    },
    preferCSSPageSize: false,
    displayHeaderFooter: false,
    omitBackground: false,
  });

  // Close the temporary page
  await newPage.close();
}

// Simplified function for retry that doesn't create directories or metadata
async function downloadPagesAsPDFForRetry(
  page: any,
  tocItems: Array<{ docbookId: string; title: string; pageNum: number }>,
  bookDir: string,
  bookNumber: string
): Promise<void> {
  try {
    console.log("Starting PDF download process for retry...");
    console.log("Using provided book number:", bookNumber);
    console.log("Using existing book directory:", bookDir);

    // Download first page sequentially
    console.log("Downloading first page sequentially...");
    await downloadSinglePage(page, tocItems[0], bookDir, bookNumber);

    // If there are more pages, download them concurrently in batches
    if (tocItems.length > 1) {
      console.log(
        `Starting concurrent download of remaining ${
          tocItems.length - 1
        } pages...`
      );
      await downloadPagesInBatches(
        page.browser(),
        tocItems.slice(1),
        bookDir,
        bookNumber
      );
    }

    console.log(`PDF retry completed! Files saved in: ${bookDir}`);
  } catch (error) {
    console.error("Error during PDF retry process:", error);
    throw error;
  }
}

// Helper function to retry failed downloads using the main workflow
export async function retryFailedDownloads(
  bookDir: string,
  bookId?: string
): Promise<void> {
  // Get failed docbook IDs from the check-downloads function
  console.log("🔄 Getting failed docbook IDs...");
  const failedItems = getFailedItems(bookDir);

  if (failedItems.length === 0) {
    console.log("🎉 No failed downloads found! All pages are complete.");
    return;
  }

  const failedDocbookIds = failedItems.map((item) => item.docbookId);
  console.log(
    `Found ${failedDocbookIds.length} failed docbook IDs:`,
    failedDocbookIds
  );

  // Use the main workflow but with specific docbook IDs
  let browser: any = null;

  try {
    // Login first
    const { browser: loginBrowser, page } = await loginToPandoraCampus();
    browser = loginBrowser;

    // Skip navigation to books page and directly download the failed ones
    // We already have the docbook IDs, so we can directly call the download function
    console.log("Starting download of failed pages...");

    // Read the correct page numbers and titles from output.json or metadata.json
    let tocItems: Array<{ docbookId: string; title: string; pageNum: number }> =
      [];

    try {
      // Try to read from output.json first (has more complete info)
      const outputPath = path.join(bookDir, "output.json");
      if (fs.existsSync(outputPath)) {
        const outputData = JSON.parse(fs.readFileSync(outputPath, "utf8"));
        const downloadStatuses = outputData.downloadStatuses || [];

        tocItems = failedDocbookIds.map((docbookId) => {
          const item = downloadStatuses.find(
            (status: any) => status.docbookId === docbookId
          );
          return {
            docbookId: docbookId,
            title: item?.title || `Unknown Title (${docbookId})`,
            pageNum: item?.pageNum || 0,
          };
        });

        console.log("📖 Using page info from output.json");
      } else {
        // Fallback to metadata.json
        const metadataPath = path.join(bookDir, "metadata.json");
        if (fs.existsSync(metadataPath)) {
          const metadataData = JSON.parse(
            fs.readFileSync(metadataPath, "utf8")
          );
          const tableOfContents = metadataData.tableOfContents || [];

          tocItems = failedDocbookIds.map((docbookId) => {
            const item = tableOfContents.find(
              (toc: any) => toc.docbookId === docbookId
            );
            return {
              docbookId: docbookId,
              title: item?.title || `Unknown Title (${docbookId})`,
              pageNum: item?.pageNum || 0,
            };
          });

          console.log("📖 Using page info from metadata.json");
        } else {
          // Last resort: create fake data
          tocItems = failedDocbookIds.map((docbookId, index) => ({
            docbookId: docbookId,
            title: `Retry Page ${index + 1}`,
            pageNum: index + 1,
          }));

          console.log(
            "⚠️ No metadata files found, using fallback page numbers"
          );
        }
      }
    } catch (error) {
      console.error("❌ Error reading metadata files:", error);
      // Fallback to fake data
      tocItems = failedDocbookIds.map((docbookId, index) => ({
        docbookId: docbookId,
        title: `Retry Page ${index + 1}`,
        pageNum: index + 1,
      }));
    }

    // Use provided book ID or extract from directory path
    let bookNumber: string;
    if (bookId) {
      bookNumber = bookId;
      console.log("Using provided book ID:", bookNumber);
    } else {
      const bookDirName = bookDir.split(/[/\\]/).pop() || "";
      bookNumber = bookDirName.replace(/_/g, ".");
      console.log("Using inferred book ID from directory:", bookNumber);
    }

    // Call the download function directly with book number and existing book directory
    await downloadPagesAsPDFForRetry(page, tocItems, bookDir, bookNumber);
  } catch (error) {
    console.error("Failed to execute retry automation:", error);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
      console.log("Browser closed.");
    }
  }
}

// Main function
async function main(): Promise<void> {
  let browser: any = null;

  try {
    // Login first
    const { browser: loginBrowser, page } = await loginToPandoraCampus();
    browser = loginBrowser;

    // After successful login, navigate to books and read first book
    await navigateToMyBooksAndRead(page);
  } catch (error) {
    console.error("Failed to execute automation:", error);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
      console.log("Browser closed.");
    }
  }
}

// Run the main function only if this file is executed directly (not imported)
if (require.main === module) {
  main();
}
