// [content.js] 2차원 배열 유지 + 입력/출력 설명 추가 버전

let isProcessing = false;
const processedSubmissions = new Set();

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

async function startProcess(submitId, problemId, language) {
  try {
    // A. 소스 코드
    const sourceRes = await fetch(`https://www.acmicpc.net/source/${submitId}`);
    const sourceHtml = await sourceRes.text();
    const parser = new DOMParser();
    const sourceDoc = parser.parseFromString(sourceHtml, "text/html");
    const code = sourceDoc.querySelector('textarea[name="source"]').value;

    // B. 문제 정보
    const problemRes = await fetch(`https://www.acmicpc.net/problem/${problemId}`);
    const problemHtml = await problemRes.text();
    const problemDoc = parser.parseFromString(problemHtml, "text/html");

    const titleElement = problemDoc.querySelector("#problem_title");
    const realTitle = titleElement ? titleElement.innerText.trim() : `${problemId}번 문제`;
    const fullTitle = `${problemId}번: ${realTitle}`;

    // 1. 문제 본문
    const description = problemDoc.querySelector("#problem_description")?.innerText.trim() || "내용 없음";

    // [NEW] 2. 입력 설명 & 출력 설명 추가
    const problemInput = problemDoc.querySelector("#problem_input")?.innerText.trim() || "입력 설명 없음";
    const problemOutput = problemDoc.querySelector("#problem_output")?.innerText.trim() || "출력 설명 없음";

    // 3. 예제 입출력
    const inputEx = problemDoc.querySelector("#sample-input-1")?.innerText.trim() || "없음";
    const outputEx = problemDoc.querySelector("#sample-output-1")?.innerText.trim() || "없음";

    // C. 전송
    chrome.runtime.sendMessage(
      {
        action: "analyzeAndUpload",
        data: {
          code,
          title: fullTitle,
          problemId,
          desc: description,
          problemInput, // [추가됨]
          problemOutput, // [추가됨]
          input: inputEx,
          output: outputEx,
          language,
        },
      },
      (response) => {
        if (response.success) {
          showToast(`"${realTitle}" 정리 완료!`, "success");
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
