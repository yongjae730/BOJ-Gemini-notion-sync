// [background.js] 수식(LaTeX) 렌더링 지원 버전

// 1. [NEW] 텍스트를 분석해서 수식과 일반 글자로 나누는 함수
function createRichText(text) {
  if (!text) return [];

  // 백준의 수식은 \( ... \) 로 감싸져 있음. 이걸 기준으로 쪼갭니다.
  // 예: "자연수 \(N\)이 주어진다" -> ["자연수 ", "\(N\)", "이 주어진다"]
  const tokens = text.split(/(\\\(.*?\\\))/g);

  return tokens.map((token) => {
    // 수식인 경우 ( \( 로 시작하고 \) 로 끝나는 경우 )
    if (token.startsWith("\\(") && token.endsWith("\\)")) {
      const expression = token.slice(2, -2); // 앞뒤 \(, \) 제거
      return {
        type: "equation",
        equation: { expression: expression },
      };
    } else {
      // 일반 텍스트인 경우
      return {
        type: "text",
        text: { content: token },
      };
    }
  });
}

// 언어 변환 함수
function mapBojLangToNotion(bojLang) {
  const lang = bojLang.toLowerCase();
  if (lang.includes("node")) return "javascript";
  if (lang.includes("java") && !lang.includes("script")) return "java";
  if (lang.includes("python") || lang.includes("pypy")) return "python";
  if (lang.includes("c++")) return "c++";
  if (lang === "c" || lang.includes("c11")) return "c";
  return "plain text";
}

// 텍스트 청소 유틸
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
  const { code, title, problemId, desc, problemInput, problemOutput, input, output, language } = data;

  const notionLang = mapBojLangToNotion(language);
  const keys = await chrome.storage.sync.get(["geminiKey", "notionToken", "dbId"]);

  if (!keys.geminiKey || !keys.notionToken || !keys.dbId) {
    throw new Error("API 키를 먼저 설정해주세요.");
  }

  // 1. Gemini 분석 (가장 안정적인 모델 사용)
  // 1. Gemini 분석

  const prompt = `
      너는 알고리즘 멘토야. 아래 **${language}** 코드를 분석해줘.
      [규칙]
      1. 결과는 반드시 순수한 JSON.
      2. "analysis"는 1000자 이내로 작성해줘.
      3. 첫 문장은 핵심 요약, 이후는 단계별 설명.
      4. 구어체 사용("~했습니다").
      5. 마크다운 기호(**, \`) 절대 금지.
      6. JSON 예시: {"analysis": ["BFS 문제입니다.", "큐를 썼습니다."], "tags": ["BFS"]}
      7. tags는 알고리즘 유형 키워드로 하고 한글태그로.
      코드:
      ${code}
    `;

  // [중요] 사용 가능한 모델로 변경 (2.5-flash-lite)
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${keys.geminiKey}`;

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

  // [A] 문제 정보 (토글) - 여기에서 createRichText 함수를 사용합니다!
  childrenBlocks.push({
    object: "block",
    type: "toggle",
    toggle: {
      rich_text: [{ text: { content: `📂 문제 정보: ${title} (Click)` } }],
      children: [
        // 1. 문제 본문 (수식 적용)
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: createRichText(desc.substring(0, 1500)) },
        },

        // 2. 입력 설명 (수식 적용)
        { object: "block", type: "heading_3", heading_3: { rich_text: [{ text: { content: "입력" } }] } },
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: createRichText(problemInput.substring(0, 1000)) },
        },

        // 3. 출력 설명 (수식 적용)
        { object: "block", type: "heading_3", heading_3: { rich_text: [{ text: { content: "출력" } }] } },
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: createRichText(problemOutput.substring(0, 1000)) },
        },

        // 4. 예제 (얘네는 그냥 텍스트/코드로 유지)
        { object: "block", type: "heading_3", heading_3: { rich_text: [{ text: { content: "예제 입력 1" } }] } },
        { object: "block", type: "code", code: { language: "plain text", rich_text: [{ text: { content: input.substring(0, 1000) } }] } },

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
    // AI 분석 내용에도 혹시 수식이 있을 수 있으니 createRichText 적용
    const richContent = createRichText(cleaned);

    if (index === 0) {
      childrenBlocks.push({
        object: "block",
        type: "quote",
        quote: { rich_text: richContent },
      });
    } else {
      childrenBlocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richContent },
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
