let isProcessing = false;
const processedSubmissions = new Set();

// 1. 기억 기능
chrome.storage.local.get(["processedList"], (result) => {
  if (result.processedList) {
    result.processedList.forEach((id) => processedSubmissions.add(id));
    console.log("기존 처리 목록 로드 완료:", processedSubmissions.size + "개");
  }
});

// 2. 알림 UI
function showToast(message, type = "info") {
  const existingToast = document.getElementById("boj-notion-toast");
  if (existingToast) existingToast.remove();

  const toast = document.createElement("div");
  toast.id = "boj-notion-toast";
  toast.style.position = "fixed";
  toast.style.top = "20px";
  toast.style.right = "20px";
  toast.style.padding = "15px 20px";
  toast.style.borderRadius = "8px";
  toast.style.color = "white";
  toast.style.fontWeight = "bold";
  toast.style.zIndex = "9999";
  toast.style.boxShadow = "0 4px 6px rgba(0,0,0,0.2)";
  toast.style.fontSize = "14px";
  toast.style.display = "flex";
  toast.style.alignItems = "center";
  toast.style.gap = "10px";

  if (type === "info") {
    toast.style.backgroundColor = "#2196F3";
    toast.innerHTML = "<span>🤖</span> " + message;
  } else if (type === "success") {
    toast.style.backgroundColor = "#4CAF50";
    toast.innerHTML = "<span>✅</span> " + message;
  } else if (type === "error") {
    toast.style.backgroundColor = "#F44336";
    toast.innerHTML = "<span>❌</span> " + message;
  }

  document.body.appendChild(toast);
  if (type === "success") {
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 500);
    }, 4000);
  }
}

// 3. 표(Table) -> <pre> 변환
function convertTablesToText(element) {
  if (!element) return;
  const tables = element.querySelectorAll("table");
  tables.forEach((table) => {
    let tableText = "";
    const rows = table.querySelectorAll("tr");
    rows.forEach((row) => {
      let rowParts = [];
      const cells = row.querySelectorAll("td, th");
      cells.forEach((cell) => rowParts.push(cell.innerText.trim()));
      tableText += rowParts.join("  ") + "\n";
    });
    const pre = document.createElement("pre");
    pre.style.margin = "10px 0";
    pre.style.fontFamily = "monospace";
    pre.textContent = tableText;
    table.replaceWith(pre);
  });
}

// 4. 코드 블록(<pre>) -> 마크다운(```) 변환
function convertPresToBackticks(element) {
  if (!element) return;
  const pres = element.querySelectorAll("pre");
  pres.forEach((pre) => {
    if (!pre.style.fontFamily) {
      pre.innerText = "\n```\n" + pre.innerText.trim() + "\n```\n";
    }
  });
}

// 5. 채점 현황 감지
const observer = new MutationObserver((mutations) => {
  if (isProcessing) return;
  const rows = document.querySelectorAll("#status-table tbody tr");
  if (rows.length === 0) return;

  const firstRow = rows[0];
  const submitId = firstRow.id.replace("solution-", "");

  if (processedSubmissions.has(submitId)) return;

  const resultCell = firstRow.querySelector(".result-text");
  if (resultCell && resultCell.innerText.includes("맞았습니다")) {
    isProcessing = true;
    processedSubmissions.add(submitId);

    const langText = firstRow.querySelector("td:nth-child(7)").innerText.trim();
    showToast(`정답! (${langText}) 분석을 시작합니다...`, "info");

    const problemId = firstRow.querySelector('a[href^="/problem/"]').innerText;
    startProcess(submitId, problemId, langText);
  }
});

const targetNode = document.getElementById("status-table");
if (targetNode) {
  observer.observe(targetNode, { childList: true, subtree: true });
}

// 6. 데이터 수집
async function startProcess(submitId, problemId, language) {
  try {
    const sourceRes = await fetch(`https://www.acmicpc.net/source/${submitId}`);
    const sourceHtml = await sourceRes.text();
    const parser = new DOMParser();
    const sourceDoc = parser.parseFromString(sourceHtml, "text/html");
    const code = sourceDoc.querySelector('textarea[name="source"]').value;

    const problemRes = await fetch(`https://www.acmicpc.net/problem/${problemId}`);
    const problemHtml = await problemRes.text();
    const problemDoc = parser.parseFromString(problemHtml, "text/html");

    const titleElement = problemDoc.querySelector("#problem_title");
    const fullTitle = `${problemId}번: ${titleElement ? titleElement.innerText.trim() : `${problemId}번 문제`}`;

    const tagElements = problemDoc.querySelectorAll('a[href^="/problem/tag/"]');
    const problemTags = Array.from(tagElements).map((el) => el.innerText.trim());

    const descEl = problemDoc.querySelector("#problem_description");
    const inputEl = problemDoc.querySelector("#problem_input");
    const outputEl = problemDoc.querySelector("#problem_output");
    const hintEl = problemDoc.querySelector("#problem_hint");

    let descriptionBlocks = [];
    let descText = "";

    if (descEl) {
      descText = descEl.innerText.trim();
      const descClone = descEl.cloneNode(true);
      const imgs = descClone.querySelectorAll("img");
      const imgMap = {};

      imgs.forEach((img, index) => {
        const rawSrc = img.getAttribute("src");
        if (!rawSrc) return;

        let fullSrc = "";
        try {
          // 절대 경로로 변환
          fullSrc = new URL(rawSrc, "https://www.acmicpc.net").href;
        } catch (e) {
          console.error("URL 변환 실패:", e);
          return;
        }

        // [핵심] AWS S3 링크인 경우에만 이미지로 처리
        if (fullSrc.includes("amazonaws.com")) {
          const marker = `{{__IMG_${index}__}}`;
          imgMap[marker] = fullSrc;

          const span = document.createElement("span");
          span.innerText = `\n${marker}\n`; // 나중에 이미지 블록으로 변환됨
          img.replaceWith(span);
        } else {
          // S3가 아니면(백준 서버 등) -> 404 에러 방지를 위해 텍스트 링크로 대체
          const span = document.createElement("span");
          // 노션에 텍스트로 "(이미지 보기: 주소)" 형태로 들어감
          span.innerText = `\n (이미지 보기: ${fullSrc}) \n`;
          img.replaceWith(span);
        }
      });

      convertTablesToText(descClone);
      convertPresToBackticks(descClone);

      const rawText = descClone.innerText;
      const parts = rawText.split(/({{__IMG_\d+__}})/g);

      parts.forEach((part) => {
        const trimmed = part.trim();
        if (!trimmed) return;
        if (trimmed.match(/{{__IMG_\d+__}}/)) {
          descriptionBlocks.push({ type: "image", content: imgMap[trimmed] });
        } else {
          descriptionBlocks.push({ type: "text", content: trimmed });
        }
      });
    }

    [inputEl, outputEl, hintEl].forEach((el) => {
      convertTablesToText(el);
      convertPresToBackticks(el);
    });

    const problemInput = inputEl?.innerText.trim() || "입력 설명 없음";
    const problemOutput = outputEl?.innerText.trim() || "출력 설명 없음";
    const problemHint = hintEl?.innerText.trim() || "";
    const inputEx = problemDoc.querySelector("#sample-input-1")?.innerText.trim() || "없음";
    const outputEx = problemDoc.querySelector("#sample-output-1")?.innerText.trim() || "없음";

    chrome.runtime.sendMessage(
      {
        action: "analyzeAndUpload",
        data: {
          code,
          title: fullTitle,
          problemId,
          descBlocks: descriptionBlocks,
          desc: descText, // [중요] 안전장치용 텍스트 추가
          problemInput,
          problemOutput,
          problemHint,
          input: inputEx,
          output: outputEx,
          language,
          tags: problemTags,
        },
      },
      (response) => {
        if (response.success) {
          showToast(`"${fullTitle}" 저장 완료!`, "success");
          chrome.storage.local.set({ processedList: Array.from(processedSubmissions) });
        } else {
          showToast(`실패: ${response.error || "오류"}\n(새로고침하면 다시 시도합니다)`, "error");
        }
        isProcessing = false;
      }
    );
  } catch (e) {
    console.error("수집 실패:", e);
    showToast("데이터 수집 중 오류 발생\n(새로고침하면 다시 시도합니다)", "error");
    isProcessing = false;
  }
}
