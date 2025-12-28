// [background.js] URL 문법 오류 수정 완료

// 텍스트 분석
function createRichText(text) {
  if (!text) return [];

  const tokens = text.split(/(\\\(.*?\\\)|(?:\$[^\$]+?\$)|(?:```[\s\S]*?```))/g);

  return tokens.map((token) => {
    if (token.startsWith("\\(") && token.endsWith("\\)")) {
      return { type: "equation", equation: { expression: token.slice(2, -2) } };
    } else if (token.startsWith("$") && token.endsWith("$") && token.length > 2) {
      return { type: "equation", equation: { expression: token.slice(1, -1) } };
    } else if (token.startsWith("```") && token.endsWith("```")) {
      const content = token.slice(3, -3).trim();
      return {
        type: "text",
        text: { content: content },
        annotations: { code: true, color: "red" },
      };
    } else {
      return { type: "text", text: { content: token } };
    }
  });
}

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
  let str = String(text).replace(/`/g, "").replace(/\*\*/g, "").replace(/__/g, "");
  str = str.replace(/^\s*[-*]\s+/gm, "").replace(/^\s*\d+\.\s+/gm, "");
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
  const { code, title, problemId, desc, problemInput, problemOutput, problemHint, input, output, language, tags } = data;
  const notionLang = mapBojLangToNotion(language);

  // 키 가져오기 + [안전장치] 공백 제거(.trim)
  const storageData = await chrome.storage.sync.get(["geminiKey", "notionToken", "dbId"]);
  const keys = {
    geminiKey: storageData.geminiKey ? storageData.geminiKey.trim() : "",
    notionToken: storageData.notionToken ? storageData.notionToken.trim() : "",
    dbId: storageData.dbId ? storageData.dbId.trim() : "",
  };

  if (!keys.geminiKey || !keys.notionToken || !keys.dbId) throw new Error("API 키 설정 필요");

  // Gemini 요청
  const prompt = `
      너는 취업을 준비하는 중인 취준생이야. 아래 **${language}** 코드를 분석해줘.
      너는 이력서 작성란에 알고리즘 공부한 노션 링크를 첨부할 예정이야.
      보통은 블로그로 작성하지만 노션을 사용하고 있어.
      그래서 너는 너의 코드가 어떤 유형의 알고리즘 문제인지, 어떤 풀이 전략을 사용했는지 분석한 내용을 싣기 위해 노력해야 해.
      아래 규칙을 따라 작성해줘.
      [규칙]
      1. 결과는 반드시 순수한 JSON.
      2. "analysis"는 1000자 이내로 작성해줘.
      3. 첫 문장은 핵심 요약, 이후는 단계별 설명.
      4. JSON 예시: {"analysis": ["BFS 문제입니다.", "큐를 썼습니다."], "tags": ["BFS"]}
      코드: ${code}
    `;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.geminiKey}`;

  const geminiRes = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!geminiRes.ok) {
    const errData = await geminiRes.json();
    throw new Error(`Gemini 오류: ${errData.error?.message || "알 수 없는 에러"}`);
  }

  const geminiJson = await geminiRes.json();
  const resText = geminiJson.candidates[0].content.parts[0].text;
  const match = resText
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim()
    .match(/\{[\s\S]*\}/);

  let analysisData = { analysis: ["분석 실패"] };
  if (match) {
    try {
      analysisData = JSON.parse(match[0]);
    } catch (e) {}
  }

  // 노션 블록 조립
  const childrenBlocks = [];
  const problemInfoChildren = [
    { object: "block", type: "paragraph", paragraph: { rich_text: createRichText(desc.substring(0, 1500)) } },
    { object: "block", type: "heading_3", heading_3: { rich_text: [{ text: { content: "입력" } }] } },
    { object: "block", type: "paragraph", paragraph: { rich_text: createRichText(problemInput.substring(0, 1000)) } },
    { object: "block", type: "heading_3", heading_3: { rich_text: [{ text: { content: "출력" } }] } },
    { object: "block", type: "paragraph", paragraph: { rich_text: createRichText(problemOutput.substring(0, 1000)) } },
  ];

  if (problemHint && problemHint.length > 0) {
    problemInfoChildren.push({ object: "block", type: "heading_3", heading_3: { rich_text: [{ text: { content: "힌트" } }] } });
    problemInfoChildren.push({ object: "block", type: "paragraph", paragraph: { rich_text: createRichText(problemHint.substring(0, 1000)) } });
  }

  problemInfoChildren.push(
    { object: "block", type: "heading_3", heading_3: { rich_text: [{ text: { content: "예제 입력 1" } }] } },
    { object: "block", type: "code", code: { language: "plain text", rich_text: [{ text: { content: input.substring(0, 1000) } }] } },
    { object: "block", type: "heading_3", heading_3: { rich_text: [{ text: { content: "예제 출력 1" } }] } },
    { object: "block", type: "code", code: { language: "plain text", rich_text: [{ text: { content: output.substring(0, 1000) } }] } }
  );

  childrenBlocks.push({
    object: "block",
    type: "toggle",
    toggle: {
      rich_text: [{ text: { content: `📂 문제 정보: ${title} (Click)` } }],
      children: problemInfoChildren,
    },
  });

  childrenBlocks.push({ object: "block", type: "heading_2", heading_2: { rich_text: [{ text: { content: "💡 풀이 전략" } }] } });

  const analysisList = analysisData.analysis || ["분석 내용 없음"];
  analysisList.forEach((line, index) => {
    const richContent = createRichText(cleanText(line));
    if (index === 0) childrenBlocks.push({ object: "block", type: "quote", quote: { rich_text: richContent } });
    else childrenBlocks.push({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: richContent } });
  });

  childrenBlocks.push({ object: "block", type: "heading_2", heading_2: { rich_text: [{ text: { content: `💻 ${language} Code` } }] } });
  for (let i = 0; i < code.length; i += 2000) {
    childrenBlocks.push({
      object: "block",
      type: "code",
      code: { language: notionLang, rich_text: [{ text: { content: code.substring(i, i + 2000) } }] },
    });
  }

  const today = new Date().toISOString().split("T")[0];
  const finalTags = (tags || []).map((tag) => ({ name: tag }));

  // [수정 완료] URL에서 불필요한 괄호 [] () 제거함
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
        알고리즘: { multi_select: finalTags },
      },
      children: childrenBlocks,
    }),
  });

  if (!notionRes.ok) {
    const err = await notionRes.json();
    throw new Error(`노션 전송 실패: ${err.message}`);
  }
}
