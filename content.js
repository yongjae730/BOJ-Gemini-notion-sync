// [content.js] 2차원 배열 강력 줄바꿈(<pre>) + 영구 기억 + 언어 감지

let isProcessing = false;
const processedSubmissions = new Set();

// 1. [기억 기능] 저장소에서 이미 처리한 목록 불러오기
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

  if (type !== "info") {
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 500);
    }, 4000);
  }
}

// 3. [핵심 수정] 표(Table)를 <pre> 태그로 변환 (줄바꿈 강제 적용)
function convertTablesToText(element) {
  if (!element) return;

  const tables = element.querySelectorAll("table");
  tables.forEach((table) => {
    let tableText = ""; // 문자열로 누적
    const rows = table.querySelectorAll("tr");

    rows.forEach((row) => {
      let rowParts = [];
      const cells = row.querySelectorAll("td, th");
      cells.forEach((cell) => {
        rowParts.push(cell.innerText.trim());
      });
      // 행 데이터 + 줄바꿈(\n) 명시적 추가
      tableText += rowParts.join("  ") + "\n";
    });

    // <pre> 태그 생성: 이 태그 안의 \n은 브라우저가 절대 무시하지 않음
    const pre = document.createElement("pre");
    pre.style.margin = "10px 0"; // 보기 좋게 여백
    pre.style.fontFamily = "monospace"; // 고정폭 글꼴 (줄 맞춤)
    pre.textContent = tableText; // 텍스트 삽입

    table.replaceWith(pre);
  });
}

// 4. 채점 현황 감지
const observer = new MutationObserver((mutations) => {
  if (isProcessing) return;

  const rows = document.querySelectorAll("#status-table tbody tr");
  if (rows.length === 0) return;

  const firstRow = rows[0];
  const submitId = firstRow.id.replace("solution-", "");

  // [기억 기능]
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

// 5. 데이터 수집
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
    const realTitle = titleElement ? titleElement.innerText.trim() : `${problemId}번 문제`;
    const fullTitle = `${problemId}번: ${realTitle}`;

    // [표 해결] 가져오기 전에 표 변환 수행!
    const descEl = problemDoc.querySelector("#problem_description");
    const inputEl = problemDoc.querySelector("#problem_input");
    const outputEl = problemDoc.querySelector("#problem_output");

    convertTablesToText(descEl);
    convertTablesToText(inputEl);
    convertTablesToText(outputEl);

    // <pre> 변환 후 innerText를 가져오면 줄바꿈이 유지됨
    const description = descEl?.innerText.trim() || "내용 없음";
    const problemInput = inputEl?.innerText.trim() || "입력 설명 없음";
    const problemOutput = outputEl?.innerText.trim() || "출력 설명 없음";

    const inputEx = problemDoc.querySelector("#sample-input-1")?.innerText.trim() || "없음";
    const outputEx = problemDoc.querySelector("#sample-output-1")?.innerText.trim() || "없음";

    chrome.runtime.sendMessage(
      {
        action: "analyzeAndUpload",
        data: {
          code,
          title: fullTitle,
          problemId,
          desc: description,
          problemInput,
          problemOutput,
          input: inputEx,
          output: outputEx,
          language,
        },
      },
      (response) => {
        if (response.success) {
          showToast(`"${realTitle}" 저장 완료!`, "success");
          chrome.storage.local.set({ processedList: Array.from(processedSubmissions) });
        } else {
          showToast("실패: " + (response.error || "오류"), "error");
          processedSubmissions.delete(submitId);
        }
        isProcessing = false;
      }
    );
  } catch (e) {
    console.error("수집 실패:", e);
    showToast("데이터 수집 중 오류 발생", "error");
    isProcessing = false;
    processedSubmissions.delete(submitId);
  }
}
