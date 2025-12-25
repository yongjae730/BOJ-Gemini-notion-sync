document.addEventListener("DOMContentLoaded", () => {
  const geminiKeyInput = document.getElementById("geminiKey");
  const notionTokenInput = document.getElementById("notionToken");
  const dbIdInput = document.getElementById("dbId");
  const saveBtn = document.getElementById("saveBtn");
  const runBtn = document.getElementById("runBtn");
  const resetBtn = document.getElementById("resetBtn");
  const settingsDiv = document.getElementById("settings");
  const actionDiv = document.getElementById("actionArea");
  const statusMsg = document.getElementById("status");

  // 1. 저장된 키 확인
  chrome.storage.sync.get(["geminiKey", "notionToken", "dbId"], (items) => {
    if (items.geminiKey && items.notionToken && items.dbId) {
      settingsDiv.classList.add("hidden");
      actionDiv.classList.remove("hidden");
    }
  });

  // 2. 저장 버튼 클릭
  saveBtn.addEventListener("click", () => {
    const keys = {
      geminiKey: geminiKeyInput.value,
      notionToken: notionTokenInput.value,
      dbId: dbIdInput.value,
    };
    if (!keys.geminiKey || !keys.notionToken || !keys.dbId) {
      statusMsg.style.color = "red";
      statusMsg.textContent = "모든 항목을 입력해주세요.";
      return;
    }
    chrome.storage.sync.set(keys, () => {
      statusMsg.style.color = "green";
      statusMsg.textContent = "저장 완료!";
      setTimeout(() => {
        statusMsg.textContent = "";
        settingsDiv.classList.add("hidden");
        actionDiv.classList.remove("hidden");
      }, 800);
    });
  });

  // 3. 설정 초기화 버튼
  resetBtn.addEventListener("click", () => {
    chrome.storage.sync.clear(() => {
      location.reload();
    });
  });

  // 4. 실행 버튼 클릭
  runBtn.addEventListener("click", () => {
    statusMsg.style.color = "blue";
    statusMsg.textContent = "🔍 코드와 문제를 읽는 중...";

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript(
        {
          target: { tabId: tabs[0].id },
          function: scrapePageData,
        },
        (results) => {
          if (chrome.runtime.lastError || !results || !results[0].result) {
            statusMsg.style.color = "red";
            statusMsg.textContent = "백준 소스코드 페이지가 아닙니다!";
            return;
          }

          const pageData = results[0].result;
          statusMsg.textContent = "🤖 Gemini가 분석 중... (최대 10초)";

          // 백그라운드로 데이터 전송
          chrome.runtime.sendMessage(
            {
              action: "analyzeAndUpload",
              data: pageData,
            },
            (response) => {
              if (response && response.success) {
                statusMsg.style.color = "green";
                statusMsg.textContent = "✅ 노션 업로드 성공!";
              } else {
                statusMsg.style.color = "red";
                statusMsg.textContent = "실패: " + (response ? response.error : "알 수 없는 오류");
              }
            }
          );
        }
      );
    });
  });
});

// [Content Script] 웹페이지에서 데이터 긁어오기
function scrapePageData() {
  // 1. 소스 코드 가져오기
  const codeElements = document.getElementsByName("source");
  let sourceCode = "";
  if (codeElements.length > 0) {
    sourceCode = codeElements[0].value;
  } else {
    const pres = document.getElementsByTagName("pre");
    if (pres.length > 0) sourceCode = pres[0].innerText;
  }

  // 2. 문제 제목 및 번호 가져오기
  // 보통 제목이 "1000번: A+B" 형태임
  const titleElem = document.querySelector("title");
  const titleFull = titleElem ? titleElem.innerText : "알고리즘 문제";
  const title = titleFull.split(":")[0].trim(); // "1000번" 같은 앞부분이나 전체 사용

  // 문제 링크 찾기 (소스코드 페이지 상단에 보통 문제 링크가 있음)
  // 예: <a href="/problem/1000">1000번</a>
  const problemLink = document.querySelector('a[href^="/problem/"]');
  const problemId = problemLink ? problemLink.getAttribute("href").split("/")[2] : null;

  if (!sourceCode) return null;
  return { code: sourceCode, title: title, problemId: problemId };
}
