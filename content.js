// [content.js] 채점 현황 감지 및 데이터 크롤링 전문

let isProcessing = false;
// [핵심] 이미 처리한 제출 번호를 저장하는 목록 (중복 실행 방지)
const processedSubmissions = new Set();

// 1. 화면 알림 함수 (Toast)
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

  // 4초 뒤 제거 (성공/실패 시)
  if (type !== "info") {
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 500);
    }, 4000);
  }
}

// 2. HTML 태그 제거 및 텍스트 추출 (DOMParser 사용)
function parseHtmlText(htmlString, selector) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");
  const element = doc.querySelector(selector);
  return element ? element.innerText.trim() : "내용 없음";
}

// 3. 채점 현황 감지
const observer = new MutationObserver((mutations) => {
  if (isProcessing) return;

  const rows = document.querySelectorAll("#status-table tbody tr");
  if (rows.length === 0) return;

  const firstRow = rows[0];

  // 제출 번호 추출 (중복 방지용 key)
  // id="solution-123456" 형태
  const submitId = firstRow.id.replace("solution-", "");

  // [중요] 이미 처리한 제출이면 무시! (스크롤 문제 해결)
  if (processedSubmissions.has(submitId)) return;

  const resultCell = firstRow.querySelector(".result-text");

  // "맞았습니다" 감지
  if (resultCell && resultCell.innerText.includes("맞았습니다")) {
    isProcessing = true;
    processedSubmissions.add(submitId); // 처리 목록에 등록

    showToast("정답입니다! 데이터 수집 및 AI 분석 시작...", "info");

    const problemId = firstRow.querySelector('a[href^="/problem/"]').innerText;

    // 데이터 수집 시작
    startProcess(submitId, problemId);
  }
});

const targetNode = document.getElementById("status-table");
if (targetNode) {
  observer.observe(targetNode, { childList: true, subtree: true });
}

// 4. 데이터 수집 (소스코드 + 문제정보)
async function startProcess(submitId, problemId) {
  try {
    // A. 소스 코드 가져오기
    const sourceRes = await fetch(`https://www.acmicpc.net/source/${submitId}`);
    const sourceHtml = await sourceRes.text();
    const parser = new DOMParser();
    const sourceDoc = parser.parseFromString(sourceHtml, "text/html");
    const code = sourceDoc.querySelector('textarea[name="source"]').value;

    // B. 문제 정보 가져오기 (제목, 본문, 입출력)
    const problemRes = await fetch(`https://www.acmicpc.net/problem/${problemId}`);
    const problemHtml = await problemRes.text();
    const problemDoc = parser.parseFromString(problemHtml, "text/html");

    // [수정] 문제 제목 정확히 가져오기 (#problem_title)
    const titleElement = problemDoc.querySelector("#problem_title");
    const realTitle = titleElement ? titleElement.innerText.trim() : `${problemId}번 문제`;
    const fullTitle = `${problemId}번: ${realTitle}`;

    // 문제 본문, 입력, 출력 (HTML 태그 제거하고 텍스트만)
    const description = problemDoc.querySelector("#problem_description")?.innerText.trim() || "내용 없음";
    const inputEx = problemDoc.querySelector("#sample-input-1")?.innerText.trim() || "없음";
    const outputEx = problemDoc.querySelector("#sample-output-1")?.innerText.trim() || "없음";

    // C. 백그라운드로 데이터 전송 (이제 background.js는 받아서 쏘기만 하면 됨)
    chrome.runtime.sendMessage(
      {
        action: "analyzeAndUpload",
        data: {
          code: code,
          title: fullTitle, // 정확한 제목
          problemId: problemId,
          desc: description,
          input: inputEx,
          output: outputEx,
        },
      },
      (response) => {
        if (response.success) {
          showToast(`"${realTitle}" 정리 완료! 노션에 저장되었습니다.`, "success");
        } else {
          showToast("실패: " + (response.error || "알 수 없는 오류"), "error");
          // 실패 시 재시도를 위해 처리 목록에서 제거 (선택사항)
          processedSubmissions.delete(submitId);
        }
        isProcessing = false;
      }
    );
  } catch (e) {
    console.error("데이터 수집 실패:", e);
    showToast("데이터를 가져오는 중 오류가 발생했습니다.", "error");
    isProcessing = false;
    processedSubmissions.delete(submitId);
  }
}
