// [유틸] 텍스트 청소 (마크다운 기호 제거)
function cleanText(text) {
  if (!text) return "";
  let str = String(text);
  str = str.replace(/`/g, "");
  str = str.replace(/\*\*/g, "");
  str = str.replace(/__/g, "");
  str = str.replace(/^\s*[-*]\s+/gm, ""); // 리스트 기호 제거
  str = str.replace(/^\s*\d+\.\s+/gm, ""); // 숫자 리스트 제거
  return str.trim();
}

// [유틸] HTML 태그 제거
function stripHtml(html) {
  if (!html) return "";
  let text = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n");
  text = text.replace(/<[^>]+>/g, ""); // 태그 삭제
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  return text.trim();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analyzeAndUpload") {
    processRequest(request.data)
      .then((res) => {
        sendResponse({ success: true });
      })
      .catch((err) => {
        console.error(err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // 비동기 응답 유지
  }
});

async function processRequest(data) {
  const { code, title, problemId } = data;

  const keys = await chrome.storage.sync.get(["geminiKey", "notionToken", "dbId"]);
  if (!keys.geminiKey || !keys.notionToken || !keys.dbId) {
    throw new Error("API 키 설정이 필요합니다.");
  }

  // 1. 문제 정보(본문, 입력, 출력) 가져오기
  let problemInfo = { desc: "내용을 가져올 수 없습니다.", input: "없음", output: "없음" };

  if (problemId) {
    try {
      const res = await fetch(`https://www.acmicpc.net/problem/${problemId}`);
      const html = await res.text();

      // 정규식으로 필요한 부분만 쏙쏙 뽑기
      const descMatch = html.match(/<div id="problem_description"[^>]*>([\s\S]*?)<\/div>/);
      const inputMatch = html.match(/<pre[^>]*id="sample-input-1"[^>]*>([\s\S]*?)<\/pre>/);
      const outputMatch = html.match(/<pre[^>]*id="sample-output-1"[^>]*>([\s\S]*?)<\/pre>/);

      if (descMatch) problemInfo.desc = stripHtml(descMatch[1]);
      if (inputMatch) problemInfo.input = stripHtml(inputMatch[1]);
      if (outputMatch) problemInfo.output = stripHtml(outputMatch[1]);
    } catch (e) {
      console.log("문제 가져오기 실패:", e);
    }
  }

  // 2. Gemini에게 분석 요청
  const prompt = `
      너는 알고리즘 멘토야. Java 코드를 분석해줘.
      [규칙]
      1. 결과는 반드시 순수한 JSON.
      2. "analysis"는 3~5문장의 리스트(Array).
      3. 첫 문장은 핵심 요약, 이후는 단계별 설명.
      4. 구어체 사용("~했습니다").
      5. 마크다운 기호(**, \`) 절대 금지.
      6. JSON 예시: {"analysis": ["BFS 문제입니다.", "큐를 썼습니다."], "tags": ["BFS"]}
      
      코드:
      ${code}
    `;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.geminiKey}`;
  const geminiRes = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  const geminiJson = await geminiRes.json();
  if (!geminiJson.candidates) throw new Error("Gemini 응답 에러");

  const resText = geminiJson.candidates[0].content.parts[0].text;
  const jsonStr = resText
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
  const match = jsonStr.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Gemini 응답에서 JSON을 찾을 수 없습니다.");

  const analysisData = JSON.parse(match[0]);

  // 3. 노션 블록 조립
  const childrenBlocks = [];

  // [A] 접이식 문제 설명 (Toggle)
  childrenBlocks.push({
    object: "block",
    type: "toggle",
    toggle: {
      rich_text: [{ text: { content: `📂 문제 정보: ${title} (Click)` } }],
      children: [
        { object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: problemInfo.desc.substring(0, 1800) } }] } },
        { object: "block", type: "heading_3", heading_3: { rich_text: [{ text: { content: "📥 입력 예시" } }] } },
        { object: "block", type: "code", code: { language: "plain text", rich_text: [{ text: { content: problemInfo.input } }] } },
        { object: "block", type: "heading_3", heading_3: { rich_text: [{ text: { content: "📤 출력 예시" } }] } },
        { object: "block", type: "code", code: { language: "plain text", rich_text: [{ text: { content: problemInfo.output } }] } },
      ],
    },
  });

  // [B] AI 분석 (Quote + List)
  childrenBlocks.push({
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: [{ text: { content: "💡 풀이 전략" } }] },
  });

  const analysisList = analysisData.analysis || ["분석 실패"];
  analysisList.forEach((line, index) => {
    const cleaned = cleanText(line);
    if (index === 0) {
      childrenBlocks.push({
        object: "block",
        type: "quote",
        quote: { rich_text: [{ text: { content: cleaned } }] },
      });
    } else {
      childrenBlocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ text: { content: cleaned } }] },
      });
    }
  });

  // [C] 내 코드
  childrenBlocks.push({
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: [{ text: { content: "💻 Java Code" } }] },
  });
  for (let i = 0; i < code.length; i += 2000) {
    childrenBlocks.push({
      object: "block",
      type: "code",
      code: { language: "java", rich_text: [{ text: { content: code.substring(i, i + 2000) } }] },
    });
  }

  // 4. 노션 전송
  const today = new Date().toISOString().split("T")[0];
  const tags = (analysisData.tags || []).map((tag) => ({ name: tag }));

  const notionRes = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${keys.notionToken}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      parent: { database_id: keys.dbId },
      properties: {
        이름: { title: [{ text: { content: title } }] },
        날짜: { date: { start: today } },
        알고리즘: { multi_select: tags },
      },
      children: childrenBlocks,
    }),
  });

  if (!notionRes.ok) {
    const err = await notionRes.json();
    throw new Error(`노션 전송 실패: ${err.message}`);
  }
}
