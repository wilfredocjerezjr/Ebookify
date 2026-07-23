    // Initialize icons
    lucide.createIcons();

    // Elements
    const apiKeyInput = document.getElementById('api-key-input');
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');
    const fileNameDisplay = document.getElementById('file-name-display');
    const processBtn = document.getElementById('process-btn');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const pauseBtn = document.getElementById('pause-btn');
    const pauseIcon = document.getElementById('pause-icon');
    const pauseText = document.getElementById('pause-text');
    const downloadBtn = document.getElementById('download-btn');
    const emptyState = document.getElementById('empty-state');
    const flipbookContainer = document.getElementById('flipbook-container');
    
    // State
    let apiKey = localStorage.getItem('gemini_api_key') || '';
    if (apiKey) apiKeyInput.value = apiKey;
    
    let currentFile = null;
    let isProcessing = false;
    let isPaused = false;
    let currentBatch = 0;
    let totalBatches = 0;
    let totalPages = 0;
    const BATCH_SIZE = 10;
    
    let generatedHtmlPages = [];
    let pageFlipInstance = null;
    let pdfDoc = null;

    // API Key Handling
    apiKeyInput.addEventListener('input', (e) => {
      apiKey = e.target.value.trim();
      localStorage.setItem('gemini_api_key', apiKey);
    });

    // File Handling
    function handleFile(file) {
      if (file && file.type === 'application/pdf') {
        currentFile = file;
        fileNameDisplay.innerText = `${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`;
        processBtn.disabled = false;
      }
    }

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('border-emerald-500'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('border-emerald-500'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('border-emerald-500');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
    });

    // Pause/Resume
    pauseBtn.addEventListener('click', () => {
      isPaused = !isPaused;
      if (isPaused) {
        pauseIcon.setAttribute('data-lucide', 'play');
        pauseText.innerText = 'Resume';
      } else {
        pauseIcon.setAttribute('data-lucide', 'pause');
        pauseText.innerText = 'Pause';
        processNextBatch(); // Resume loop
      }
      lucide.createIcons();
    });

    // Flipbook Initialization
    function initFlipbook() {
      if (pageFlipInstance) {
        pageFlipInstance.destroy();
      }
      
      emptyState.classList.add('hidden');
      flipbookContainer.style.display = 'block';
      flipbookContainer.innerHTML = '';
      
      // Ensure even number of pages for spreads by appending a blank page if needed
      const pagesToRender = [...generatedHtmlPages];
      if (pagesToRender.length > 0 && pagesToRender.length % 2 !== 0) {
        pagesToRender.push('<div class="ebook-page-content"></div>');
      }
      // Add cover pages (front and back) if we want, or just let it render as is.
      // We need at least 2 pages to init StPageFlip smoothly, wait until we have some.
      if (pagesToRender.length < 2) {
        pagesToRender.push('<div class="ebook-page-content"></div>');
      }

      pagesToRender.forEach((pageHtml, index) => {
        const div = document.createElement('div');
        div.className = 'page';
        div.innerHTML = pageHtml;
        flipbookContainer.appendChild(div);
      });

      pageFlipInstance = new St.PageFlip(flipbookContainer, {
        width: 450,
        height: 600,
        size: 'stretch',
        minWidth: 300,
        maxWidth: 600,
        minHeight: 400,
        maxHeight: 800,
        maxShadowOpacity: 0.5,
        showCover: false,
        mobileScrollSupport: false
      });

      pageFlipInstance.loadFromHTML(flipbookContainer.querySelectorAll('.page'));
    }

    // PDF Extraction & API Calling
    processBtn.addEventListener('click', async () => {
      if (!currentFile || !apiKey) {
        alert("Please provide both a PDF file and a Gemini API Key.");
        return;
      }

      isProcessing = true;
      isPaused = false;
      currentBatch = 0;
      generatedHtmlPages = [];
      processBtn.disabled = true;
      processBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Processing...';
      lucide.createIcons();
      
      progressContainer.classList.remove('hidden');
      progressContainer.classList.add('flex');

      try {
        const arrayBuffer = await currentFile.arrayBuffer();
        pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        totalPages = pdfDoc.numPages;
        totalBatches = Math.ceil(totalPages / BATCH_SIZE);
        
        processNextBatch();
      } catch (err) {
        alert("Error loading PDF: " + err.message);
        resetState();
      }
    });

    async function processNextBatch() {
      if (isPaused) return; // Wait for resume
      
      if (currentBatch >= totalBatches) {
        finishProcessing();
        return;
      }

      const startPage = currentBatch * BATCH_SIZE + 1;
      const endPage = Math.min((currentBatch + 1) * BATCH_SIZE, totalPages);
      
      updateProgressUI(startPage, endPage);

      try {
        let batchText = '';
        for (let i = startPage; i <= endPage; i++) {
          const page = await pdfDoc.getPage(i);
          const content = await page.getTextContent();
          batchText += content.items.map(item => item.str).join(' ') + '\n\n';
        }

        const condensedHtmlPages = await callGeminiAPI(batchText);
        
        // Append new pages
        generatedHtmlPages = generatedHtmlPages.concat(condensedHtmlPages);
        
        // Update Preview
        if (generatedHtmlPages.length > 0) {
          initFlipbook();
        }

        currentBatch++;
        downloadBtn.disabled = false; // Allow download of partial results

        // Queue next batch
        setTimeout(processNextBatch, 500);

      } catch (err) {
        console.error("Batch error:", err);
        alert(`Error processing batch ${currentBatch + 1}: ${err.message}. The process is paused.`);
        isPaused = true;
        pauseIcon.setAttribute('data-lucide', 'play');
        pauseText.innerText = 'Resume';
        lucide.createIcons();
      }
    }

    function updateProgressUI(startPage, endPage) {
      const percentage = (currentBatch / totalBatches) * 100;
      progressBar.style.width = `${percentage}%`;
      progressText.innerText = `Processing Batch ${currentBatch + 1} of ${totalBatches} (Pages ${startPage}-${endPage}/${totalPages})...`;
    }

    async function callGeminiAPI(text) {
      const prompt = `You are a cognitive text compression engine generating content for a 3D offline ebook.
The user provides a batch of extracted text from a textbook.
TASK: Condense the text by ~30%, removing fluff, repetitive intros, and boilerplate, while retaining 100% of high-yield study insights, formulas, tables, and definitions.
FORMAT: Output MUST be styled as visual ebook pages using HTML. 
- Use Dark slate/glassmorphism theme principles.
- Use <div class="ebook-page-content"> as the root container for EACH page. If the content is long, split it into multiple <div class="ebook-page-content"> elements (they represent physical pages).
- Use colorful callout cards: <div class="callout tip"> or <div class="callout warning">.
- Use comparison CSS grid tables: <div class="grid-table"><div class="header">Col 1</div><div class="header">Col 2</div><div>Data 1</div><div>Data 2</div></div>
- Use geometric timelines: <div class="timeline">Event</div>
- NO external image dependencies. Use inline SVG graphics if needed.
- Return raw HTML only. Do NOT wrap in \`\`\`html. 

Text batch:
${text}`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 }
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error?.message || "API Request failed");
      }

      const data = await response.json();
      let rawHtml = data.candidates[0].content.parts[0].text;
      
      if (rawHtml.startsWith('```html')) rawHtml = rawHtml.substring(7);
      if (rawHtml.startsWith('```')) rawHtml = rawHtml.substring(3);
      if (rawHtml.endsWith('```')) rawHtml = rawHtml.substring(0, rawHtml.length - 3);

      // Parse the returned HTML to extract individual pages
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHtml, 'text/html');
      const pageElements = doc.querySelectorAll('.ebook-page-content');
      
      const pagesArray = [];
      if (pageElements.length > 0) {
        pageElements.forEach(el => pagesArray.push(el.outerHTML));
      } else {
        // Fallback if model didn't wrap properly
        pagesArray.push(`<div class="ebook-page-content">${rawHtml}</div>`);
      }
      
      return pagesArray;
    }

    function finishProcessing() {
      isProcessing = false;
      progressBar.style.width = '100%';
      progressText.innerText = 'Processing Complete!';
      pauseBtn.style.display = 'none';
      processBtn.innerHTML = '<i data-lucide="check-circle" class="w-4 h-4"></i> Complete';
      lucide.createIcons();
    }

    function resetState() {
      isProcessing = false;
      processBtn.disabled = false;
      processBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4"></i> Start Processing';
      progressContainer.classList.add('hidden');
      progressContainer.classList.remove('flex');
      lucide.createIcons();
    }

    // Export Logic
    downloadBtn.addEventListener('click', () => {
      if (generatedHtmlPages.length === 0) return;

      const escapedPages = JSON.stringify(generatedHtmlPages).replace(/<\//g, "<\\/");
      
      const exportHtml = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ebook-ify Offline Book</title>
  <script src="https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.js"></` + `script>
  <style>
    body { margin: 0; padding: 0; background: #020617; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: system-ui, sans-serif; overflow: hidden; }
    .ebook-page-content {
      padding: 2.5rem;
      background: #0f172a; 
      color: #f8fafc;
      height: 100%;
      overflow-y: hidden;
      box-sizing: border-box;
      border: 1px solid #334155;
    }
    .ebook-page-content h1, .ebook-page-content h2, .ebook-page-content h3 { color: #f8fafc; margin-top: 1em; margin-bottom: 0.5em; font-weight: 800; letter-spacing: -0.025em; }
    .ebook-page-content p { margin-bottom: 1em; line-height: 1.6; font-size: 1rem; color: #cbd5e1; }
    .ebook-page-content ul, .ebook-page-content ol { margin-bottom: 1em; padding-left: 1.5em; color: #cbd5e1; line-height: 1.6; }
    .ebook-page-content .callout { padding: 1.25rem; border-radius: 0.75rem; margin: 1.5rem 0; border-left: 4px solid; background: rgba(255,255,255,0.05); backdrop-filter: blur(10px); }
    .ebook-page-content .callout.warning { border-color: #f59e0b; color: #fcd34d; background-color: rgba(245, 158, 11, 0.1); }
    .ebook-page-content .callout.tip { border-color: #10b981; color: #6ee7b7; background-color: rgba(16, 185, 129, 0.1); }
    .ebook-page-content .definition-card { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(12px); padding: 1.5rem; border-radius: 1rem; margin: 1.5rem 0; box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1); border: 1px solid rgba(255, 255, 255, 0.1); }
    .ebook-page-content .timeline { border-left: 3px solid #10b981; padding-left: 1.5rem; margin: 1.5rem 0; position: relative; }
    .ebook-page-content .timeline::before { content: ""; position: absolute; left: -9px; top: 0; width: 15px; height: 15px; background: #10b981; border-radius: 50%; box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.2); }
    .ebook-page-content .grid-table { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px; background: #334155; margin: 1.5rem 0; border-radius: 0.5rem; overflow: hidden; border: 1px solid #334155; }
    .ebook-page-content .grid-table > div { background: #0f172a; padding: 1rem; }
    .ebook-page-content .grid-table .header { background: #1e293b; font-weight: 700; color: #94a3b8; text-transform: uppercase; font-size: 0.85rem; }
    
    .flip-book { width: 100%; height: 100%; max-width: 1200px; max-height: 85vh; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
    .page { background-color: #0f172a; overflow: hidden; }
  </style>
</head>
<body>
  <div id="book" class="flip-book"></div>
  <script>
    const pagesData = ${escapedPages};
    
    // Ensure even length for spreads
    if (pagesData.length > 0 && pagesData.length % 2 !== 0) {
      pagesData.push('<div class="ebook-page-content"></div>');
    }
    if (pagesData.length < 2) {
      pagesData.push('<div class="ebook-page-content"></div>');
    }

    const bookEl = document.getElementById('book');
    pagesData.forEach(html => {
      const div = document.createElement('div');
      div.className = 'page';
      div.innerHTML = html;
      bookEl.appendChild(div);
    });

    const pageFlip = new St.PageFlip(bookEl, {
      width: 500,
      height: 700,
      size: 'stretch',
      minWidth: 300,
      maxWidth: 600,
      minHeight: 400,
      maxHeight: 900,
      maxShadowOpacity: 0.5,
      showCover: true,
      mobileScrollSupport: false
    });

    pageFlip.loadFromHTML(bookEl.querySelectorAll('.page'));
  </` + `script>
</body>
</html>`;

      const blob = new Blob([exportHtml], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "flipbook_ebook.html";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
