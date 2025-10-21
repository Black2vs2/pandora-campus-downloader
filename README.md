# Pandora Campus Downloader

A comprehensive automated system for downloading and processing books from Pandora Campus. This tool handles the complete workflow from login to organized PDF generation, including concurrent downloads, failure detection, retry mechanisms, and intelligent chapter merging.

## Features

- **Automated Login**: Seamless authentication with Pandora Campus
- **Concurrent Downloads**: Efficient batch downloading with configurable concurrency
- **Smart Chapter Detection**: Automatically identifies and organizes content by chapters
- **Failure Recovery**: Built-in retry mechanism for failed downloads
- **PDF Processing**: Merges individual pages into organized chapter PDFs
- **Progress Tracking**: Detailed logging and status reporting
- **File Organization**: Clean directory structure with metadata preservation

## Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Configure your credentials:**
   - Copy `src/config.example.ts` to `src/config.ts`
   - Edit `src/config.ts` and replace the placeholder values with your actual Pandora Campus credentials:
   ```typescript
   export const loginConfig: LoginConfig = {
     email: "your-actual-email@example.com",
     password: "your-actual-password",
   };
   ```

## Complete Workflow

Follow these steps to download and process a complete book:

### Step 1: Download the Book

```bash
npm run dev
```

This will:

- Log into Pandora Campus automatically
- Navigate to your books library
- Download the first available book as individual PDF pages
- Create a structured directory in `downloads/`
- Generate metadata files for tracking

**Output Structure:**

```
downloads/
└── 10_978_8815_415073/          # Book directory (DOI-based)
    ├── metadata.json            # Book metadata and table of contents
    ├── page_001_chapter1.pdf    # Individual page PDFs
    ├── page_002_section1.pdf
    ├── ...
    └── page_XXX_conclusion.pdf
```

### Step 2: Check Download Status

```bash
npm run check downloads/10_978_8815_415073
```

This will:

- Verify all expected pages were downloaded successfully
- Check file sizes to detect corrupted downloads
- Generate a detailed status report (`output.json`)
- List any failed or missing pages

**Example Output:**

```
✓ Download status check complete:
  - Success: 45/50 pages
  - Failed: 5/50 pages
  - Report saved: downloads/10_978_8815_415073/output.json

Failed pages:
  - Page 12: chapter2_section3 - "Advanced Topics"
  - Page 28: chapter4_intro - "Implementation Details"
```

### Step 3: Retry Failed Downloads (Repeat as Needed)

```bash
npm run retry downloads/10_978_8815_415073
```

Or using the book DOI:

```bash
npm run retry doi/10.978.8815/415073
```

Or with both directory and DOI (recommended):

```bash
npx ts-node .\src\retry.ts .\downloads\10_978_8815_366603\ doi/10.978.8815/366603/
```

This will:

- Identify failed downloads from the previous check
- Re-authenticate with Pandora Campus
- Download only the missing/failed pages
- Preserve existing successful downloads

**Repeat this step until all pages are successfully downloaded.**

### Step 4: Merge into Organized Chapters

```bash
npm run merge downloads/10_978_8815_415073
```

This will:

- Analyze the table of contents to identify chapter boundaries
- Merge individual page PDFs into complete chapter documents
- Create organized output in the `processed/` subdirectory
- Generate descriptive filenames based on chapter titles

**Final Output Structure:**

```
downloads/10_978_8815_415073/
├── processed/                           # Organized chapter PDFs
│   ├── premessa.pdf                    # Introduction/Preface
│   ├── chapter_01_introduction.pdf     # Chapter 1
│   ├── chapter_02_methodology.pdf      # Chapter 2
│   └── chapter_XX_conclusion.pdf       # Final chapter
├── metadata.json                       # Original metadata
├── output.json                         # Download status report
└── page_XXX_*.pdf                     # Individual pages (kept for reference)
```

## Available Scripts

- `npm run dev` - Start the main download process
- `npm run check <directory>` - Verify download completeness
- `npm run retry <directory-or-doi>` - Retry failed downloads
- `npm run merge <directory>` - Merge pages into chapters
- `npm run cleanup <directory>` - Clean up temporary files
- `npm run build` - Build the TypeScript project
- `npm run start` - Run the built JavaScript

## Advanced Usage

### Retry with Specific DOI Format

```bash
npm run retry doi/10.978.8815/415073
npm run retry downloads/10_978_8815_415073 doi/10.978.8815/415073
npx ts-node .\src\retry.ts .\downloads\10_978_8815_366603\ doi/10.978.8815/366603/
```

### Check Multiple Books

```bash
npm run check downloads/book1
npm run check downloads/book2
```

### Batch Processing

```bash
# Download
npm run dev

# Check and retry until complete
npm run check downloads/10_978_8815_415073
npm run retry downloads/10_978_8815_415073
npm run check downloads/10_978_8815_415073  # Verify again

# Final processing
npm run merge downloads/10_978_8815_415073
```

## File Structure Explained

### Metadata Files

- **`metadata.json`**: Contains book information, total pages, and table of contents
- **`output.json`**: Generated by check command, contains download status for each page

### PDF Files

- **Individual Pages**: `page_XXX_docbookid.pdf` - Original downloaded pages
- **Merged Chapters**: Located in `processed/` directory with descriptive names

### Directory Naming

- Book directories use DOI format with dots/slashes replaced by underscores
- Example: `doi/10.978.8815/415073` becomes `10_978_8815_415073`

## Troubleshooting

### Common Issues

**Login Failures:**

- Verify credentials in `src/config.ts`
- Check if Pandora Campus website structure has changed
- Ensure stable internet connection

**Download Failures:**

- Run `npm run check` to identify specific failed pages
- Use `npm run retry` to re-download failed pages
- Check available disk space

**PDF Processing Issues:**

- Ensure all individual PDFs downloaded successfully before merging
- Check that `pdf-lib` dependency is properly installed
- Verify file permissions in the downloads directory

**Browser Issues:**

- The browser runs in non-headless mode by default for debugging
- Close any existing browser instances before running
- Update Puppeteer if compatibility issues occur

### Error Recovery

1. **Partial Downloads**: Use the retry mechanism to complete missing pages
2. **Corrupted Files**: Delete corrupted PDFs and retry specific pages
3. **Network Issues**: The tool includes automatic retries and timeout handling
4. **Chapter Detection**: Manually verify chapter boundaries in `metadata.json` if merging seems incorrect

## Security Notes

- The `src/config.ts` file is excluded from git to protect your credentials
- Never commit your actual login credentials to version control
- Use the provided `config.example.ts` as a template
- Credentials are only used for authentication and are not stored or transmitted elsewhere

## Requirements

- **Node.js** (v16 or higher recommended)
- **npm** or **yarn**
- **Valid Pandora Campus account** with book access
- **Sufficient disk space** for PDF storage (books can be 50-200MB each)
- **Stable internet connection** for downloading

## Technical Details

- **Concurrent Downloads**: Uses batched concurrent processing (10 pages per batch by default)
- **Error Handling**: Comprehensive error catching and reporting at each step
- **PDF Quality**: Preserves original formatting and styling from Pandora Campus
- **Memory Management**: Efficient handling of large books with hundreds of pages
