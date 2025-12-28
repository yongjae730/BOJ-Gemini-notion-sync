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
      당신은 **성장하는 주니어 개발자**입니다. 
      아래 **${language}** 코드는 당신이 직접 푼 알고리즘 문제의 정답 코드입니다.
      이 내용은 취업 포트폴리오로 쓸 **기술 블로그(Notion)**에 올라갈 글입니다.

      **"남에게 보여주기식" 설명이 아니라, "내가 치열하게 고민한 흔적"이 드러나도록** 작성해 주세요.

      [작성 가이드]
      1. **접근 방법 (Why)**: 문제 유형을 파악하고, **"왜 이 알고리즘을 선택했는지"**에 대한 나의 판단 근거를 적으세요.
      2. **풀이 로직 (How)**: 코드의 흐름을 내가 다시 봐도 이해하기 쉽게 단계별로 요약하세요.
      3. **복잡도 분석**: 면접 대비용으로 시간/공간 복잡도(Big-O)를 분석하고, 효율적인지 스스로 평가하세요.
      4. **회고/배운 점**: 풀면서 막혔던 부분이나, 이 문제에서 얻어간 핵심 개념을 짧게 짚으세요.

      [출력 규칙]
      1. 결과는 반드시 **순수한 JSON** 포맷이어야 합니다.
      2. 말투는 **"~했다", "~이다", "~함" 등 간결하고 단정적인 평어체(반말)**를 사용하세요. (예: "BFS를 사용했다.", "시간 초과가 우려되어 DP로 변경함.")
      3. 문장은 **"~라고 판단해 ~를 적용했다"** 같이 인과관계가 명확해야 합니다.

      [JSON 예시 형식을 꼭 지킬 것]
      {
        "analysis": [
          "**💡 접근 방법**",
          "최단 거리를 구해야 하는 문제다. 간선 가중치가 모두 1이므로 **BFS(너비 우선 탐색)**가 적합하다고 판단했다. DFS는 최단 경로를 보장하지 못하므로 배제했다.",
          " ",
          "**📝 풀이 로직**",
          "1. **초기화**: 방문 처리를 위한 \`visited\` 배열과 탐색용 \`Queue\`를 선언함.",
          "2. **탐색**: 큐에서 노드를 꺼내 상하좌우를 살피고, 이동 가능하면 거리를 +1 업데이트했다.",
          "3. **종료 조건**: 목표 지점에 도달하면 즉시 횟수를 반환하도록 구현했다.",
          " ",
          "**⏳ 복잡도 분석**",
          "- **시간 복잡도**: O(N*M). 모든 칸을 한 번씩만 방문하므로 효율적이다.",
          "- **공간 복잡도**: O(N*M). 최악의 경우 큐에 모든 노드가 들어갈 수 있다.",
          " ",
          "**🚀 회고**",
          "처음엔 큐 구현을 실수해서 시간 초과가 났었다. \`ArrayDeque\`를 사용하여 큐 연산 속도를 높이는 것이 중요하다는 점을 다시 확인했다."
        ],
        "tags": ["BFS", "그래프탐색", "기본기"]
      }

      분석할 코드:
      ${code}
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
