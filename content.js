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

    // [NEW] 백준 '알고리즘 분류' 태그 직접 가져오기
    // 보통 href="/problem/tag/..." 형태의 링크로 되어 있음
    const tagElements = problemDoc.querySelectorAll('a[href^="/problem/tag/"]');
    const problemTags = Array.from(tagElements).map((el) => el.innerText.trim());

    // 요소 선택
    const descEl = problemDoc.querySelector("#problem_description");
    const inputEl = problemDoc.querySelector("#problem_input");
    const outputEl = problemDoc.querySelector("#problem_output");
    const hintEl = problemDoc.querySelector("#problem_hint");

    [descEl, inputEl, outputEl, hintEl].forEach((el) => {
      convertTablesToText(el);
      convertPresToBackticks(el);
    });

    const description = descEl?.innerText.trim() || "내용 없음";
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
          desc: description,
          problemInput,
          problemOutput,
          problemHint,
          input: inputEx,
          output: outputEx,
          language,
          tags: problemTags, // [중요] 직접 긁은 태그를 보냄
        },
      },
      (response) => {
        if (response.success) {
          showToast(`"${fullTitle}" 저장 완료!`, "success");
          // 성공했을 때만 영구 저장소(storage)에 업데이트
          chrome.storage.local.set({ processedList: Array.from(processedSubmissions) });
        } else {
          // [수정] 실패 시 재시도 로직(delete) 제거 및 안내 메시지 변경
          showToast(`실패: ${response.error || "오류"}\n(새로고침하면 다시 시도합니다)`, "error");
          // processedSubmissions.delete(submitId);  <-- 이 줄을 삭제
        }
        isProcessing = false;
      }
    );
  } catch (e) {
    console.error("수집 실패:", e);
    // [수정] 실패 시 재시도 로직(delete) 제거 및 안내 메시지 변경
    showToast("데이터 수집 중 오류 발생\n(새로고침하면 다시 시도합니다)", "error");
    isProcessing = false;
    // processedSubmissions.delete(submitId); <-- 이 줄을 삭제
  }
}
