// [background.js] 입력/출력 설명 포함 버전

function mapBojLangToNotion(bojLang) {
  const lang = bojLang.toLowerCase();
  if (lang.includes("node")) return "javascript";
  if (lang.includes("java") && !lang.includes("script")) return "java";
  if (lang.includes("python") || lang.includes("pypy")) return "python";
  if (lang.includes("c++")) return "c++";
  if (lang === "c" || lang.includes("c11")) return "c";
  return "plain text";
}

function cleanText(text) {
  if (!text) return "";
  let str = String(text);
  str = str.replace(/`/g, "");
  str = str.replace(/\*\*/g, "");
  str = str.replace(/__/g, "");
  str = str.replace(/^\s*[-*]\s+/gm, "");
  str = str.replace(/^\s*\d+\.\s+/gm, "");
  return str.trim();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analyzeAndUpload") {
    processRequest(request.data)
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error(err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
});

async function processRequest(data) {
  // problemInput, problemOutput 추가됨
  const { code, title, problemId, desc, problemInput, problemOutput, input, output, language } = data;

  const notionLang = mapBojLangToNotion(language);

  const keys = await chrome.storage.sync.get(["geminiKey", "notionToken", "dbId"]);
  if (!keys.geminiKey || !keys.notionToken || !keys.dbId) {
    throw new Error("API 키를 먼저 설정해주세요.");
  }

  // 1. Gemini 분석
  const prompt = `
      너는 알고리즘 멘토야. 아래 **${language}** 코드를 분석해줘.
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

  // gemini-3-flash 로 변경
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${keys.geminiKey}`;
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

  let analysisData = { analysis: ["분석 실패"], tags: [] };
  if (match) {
    try {
      analysisData = JSON.parse(match[0]);
    } catch (e) {}
  }

  // 2. 노션 블록 조립
  const childrenBlocks = [];

  // [A] 문제 정보 (토글) - 여기에 입력/출력 설명 추가!
  childrenBlocks.push({
    object: "block",
    type: "toggle",
    toggle: {
      rich_text: [{ text: { content: `📂 문제 정보: ${title} (Click)` } }],
      children: [
        // 1. 문제 본문
        { object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: desc.substring(0, 1500) } }] } },

        // [NEW] 2. 입력 설명
        { object: "block", type: "heading_3", heading_3: { rich_text: [{ text: { content: "입력" } }] } },
        { object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: problemInput.substring(0, 1000) } }] } },

        // [NEW] 3. 출력 설명
        { object: "block", type: "heading_3", heading_3: { rich_text: [{ text: { content: "출력" } }] } },
        { object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: problemOutput.substring(0, 1000) } }] } },

        // 4. 예제 입력
        { object: "block", type: "heading_3", heading_3: { rich_text: [{ text: { content: "예제 입력 1" } }] } },
        { object: "block", type: "code", code: { language: "plain text", rich_text: [{ text: { content: input.substring(0, 1000) } }] } },

        // 5. 예제 출력
        { object: "block", type: "heading_3", heading_3: { rich_text: [{ text: { content: "예제 출력 1" } }] } },
        { object: "block", type: "code", code: { language: "plain text", rich_text: [{ text: { content: output.substring(0, 1000) } }] } },
      ],
    },
  });

  // [B] AI 분석
  childrenBlocks.push({
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: [{ text: { content: "💡 풀이 전략" } }] },
  });

  const analysisList = analysisData.analysis || ["분석 내용 없음"];
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
    heading_2: { rich_text: [{ text: { content: `💻 ${language} Code` } }] },
  });

  for (let i = 0; i < code.length; i += 2000) {
    childrenBlocks.push({
      object: "block",
      type: "code",
      code: {
        language: notionLang,
        rich_text: [{ text: { content: code.substring(i, i + 2000) } }],
      },
    });
  }

  // 3. 노션 전송
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
