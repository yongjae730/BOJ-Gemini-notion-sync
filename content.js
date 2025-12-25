// [content.js] 채점 현황 자동 감지 및 알림 UI

let isProcessing = false;

// 1. 화면에 알림창(Toast)을 띄우는 함수 (디자인 추가)
function showToast(message, type = "info") {
  // 기존 알림이 있으면 제거
  const existingToast = document.getElementById("boj-notion-toast");
  if (existingToast) existingToast.remove();

  const toast = document.createElement("div");
  toast.id = "boj-notion-toast";

  // 스타일 설정 (우측 상단에 예쁘게 뜸)
  toast.style.position = "fixed";
  toast.style.top = "20px";
  toast.style.right = "20px";
  toast.style.padding = "15px 20px";
  toast.style.borderRadius = "8px";
  toast.style.color = "white";
  toast.style.fontWeight = "bold";
  toast.style.zIndex = "9999";
  toast.style.boxShadow = "0 4px 6px rgba(0,0,0,0.1)";
  toast.style.transition = "opacity 0.5s ease-in-out";
  toast.style.fontSize = "14px";
  toast.style.display = "flex";
  toast.style.alignItems = "center";
  toast.style.gap = "10px";

  // 상태별 색상 및 아이콘
  if (type === "info") {
    toast.style.backgroundColor = "#2196F3"; // 파란색
    toast.innerHTML = "<span>🤖</span> " + message;
  } else if (type === "success") {
    toast.style.backgroundColor = "#4CAF50"; // 초록색
    toast.innerHTML = "<span>✅</span> " + message;
  } else if (type === "error") {
    toast.style.backgroundColor = "#F44336"; // 빨간색
    toast.innerHTML = "<span>❌</span> " + message;
  }

  document.body.appendChild(toast);

  // 성공이나 에러면 4초 뒤에 사라짐
  if (type !== "info") {
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 500);
    }, 4000);
  }
}

// 2. 채점 결과 테이블 감시 (MutationObserver)
const observer = new MutationObserver((mutations) => {
  if (isProcessing) return;

  const rows = document.querySelectorAll("#status-table tbody tr");
  if (rows.length === 0) return;

  const firstRow = rows[0];
  const resultCell = firstRow.querySelector(".result-text");

  // "맞았습니다" 감지
  if (resultCell && resultCell.innerText.includes("맞았습니다")) {
    isProcessing = true;

    // 1단계 알림: 시작
    showToast("정답입니다! AI 분석 및 노션 저장을 시작합니다...", "info");

    const submitId = firstRow.id.replace("solution-", "");
    const problemId = firstRow.querySelector('a[href^="/problem/"]').innerText;

    startProcess(submitId, problemId);
  }
});

// 테이블 감시 시작
const targetNode = document.getElementById("status-table");
if (targetNode) {
  observer.observe(targetNode, { childList: true, subtree: true });
}

// 3. 데이터 처리 및 백그라운드 전송
async function startProcess(submitId, problemId) {
  try {
    const sourceUrl = `https://www.acmicpc.net/source/${submitId}`;
    const res = await fetch(sourceUrl);
    const html = await res.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const code = doc.querySelector('textarea[name="source"]').value;
    const title = doc.querySelector("title").innerText.split(":")[0].trim();

    chrome.runtime.sendMessage(
      {
        action: "analyzeAndUpload",
        data: { code, title, problemId },
      },
      (response) => {
        if (response.success) {
          // 2단계 알림: 성공
          showToast(`"${title}" 분석 완료! 노션에 저장되었습니다.`, "success");
        } else {
          // 2단계 알림: 실패
          showToast("실패: " + (response.error || "알 수 없는 오류"), "error");
        }
        isProcessing = false;
      }
    );
  } catch (e) {
    console.error("처리 실패:", e);
    showToast("처리 중 오류가 발생했습니다.", "error");
    isProcessing = false;
  }
}
