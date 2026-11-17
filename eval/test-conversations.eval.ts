// 教材のテスト会話 8件の評価（npm run eval）。
// OpenAI Embeddings・Supabase（match_faqs の読み取りのみ）・Claude API を実際に呼ぶ。DB へは書き込まない。
// 結果は eval/results/latest.json と eval/results/latest.md に保存する（秘密情報は含めない）。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateAiReply, type AiReply } from "@/lib/ai/responder";
import { getBusinessHoursStatus } from "@/lib/business-hours";

const ROOT = process.cwd();
const CSV_PATH = path.join(ROOT, "data/case4-test-conversations.csv");
const RESULTS_DIR = path.join(ROOT, "eval/results");

const OPEN_NOW = "2026-11-17T14:00:00+09:00"; // 火曜14時（営業時間内）
const CLOSED_NOW = "2026-11-17T22:00:00+09:00"; // 火曜22時（営業時間外）

// ---- CSV ---------------------------------------------------------------

/** ダブルクォート・カンマ・改行を含むフィールドに対応した最小限の CSV パーサー */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

type TestCase = { no: number; scenario: string; message: string; expected: string };

function loadCases(): TestCase[] {
  const [, ...rows] = parseCsv(readFileSync(CSV_PATH, "utf8").replace(/^﻿/, ""));
  return rows.map((r) => ({ no: Number(r[0]), scenario: r[1], message: r[2], expected: r[3] }));
}

/** 「（22:00に）返品したいのですが」の時刻注記を除き、顧客の発言だけにする */
function toQuestion(message: string): string {
  return message.replace(/^（[^）]*）/, "").trim();
}

// ---- 判定 ---------------------------------------------------------------

type Check = { label: string; pass: boolean };
const check = (label: string, pass: boolean): Check => ({ label, pass });
const has = (text: string, ...words: string[]) => words.some((w) => text.includes(w));

function judge(no: number, r: AiReply, now: Date): Check[] {
  const a = r.answer;
  const used = r.usedFaqNos;
  switch (no) {
    case 1:
      return [
        check("used_faq_nos に 1", used.includes(1)),
        check("handoff なし", !r.handoff.needed),
        check("「中旬」", has(a, "中旬")),
        check("「再入荷お知らせ」", has(a, "再入荷お知らせ", "再入荷のお知らせ")),
      ];
    case 2:
      return [
        check("used_faq_nos に 4", used.includes(4)),
        check("「550」", has(a, "550")),
        check("「5,000」/「5000」", has(a, "5,000", "5000", "５,０００", "5千")),
      ];
    case 3:
      return [
        check("used_faq_nos に 9", used.includes(9)),
        check("「8日」", has(a, "8日", "８日")),
        check("「送料」", has(a, "送料")),
        check("「当社負担」系", /(当社|弊社)(にて|で)?(ご)?負担/.test(a)),
      ];
    case 4:
      return [
        check("handoff あり", r.handoff.needed),
        check("reason が complex / no_answer", r.handoff.reason === "complex" || r.handoff.reason === "no_answer"),
      ];
    case 5:
      return [check("handoff あり", r.handoff.needed), check("reason が complaint", r.handoff.reason === "complaint")];
    case 6:
      return [
        check("数字を含まない（数値を捏造しない）", !/[0-9０-９]/.test(a)),
        check("「円」を含まない", !a.includes("円")),
        check(
          "「お答えできません」等の表明",
          /お答え(でき|いたしかね|することができ)|回答(でき|いたしかね|することができ)|ご案内(でき|いたしかね)/.test(a),
        ),
      ];
    case 7: {
      const label = getBusinessHoursStatus(now).nextOpenLabel;
      return [
        check("handoff あり", r.handoff.needed),
        check("「営業時間外」", has(a, "営業時間外")),
        check("「翌営業日」", has(a, "翌営業日")),
        check(`次回営業開始「${label}」`, has(a, label)),
      ];
    }
    case 8:
      return [check("used_faq_nos に 14", used.includes(14)), check("used_faq_nos に 17", used.includes(17))];
    default:
      return [check("未定義のケース", false)];
  }
}

// ---- 実行 ---------------------------------------------------------------

type CaseResult = {
  no: number;
  scenario: string;
  question: string;
  now: string;
  expected: string;
  pass: boolean;
  checks: Check[];
  answer: string | null;
  handoff: AiReply["handoff"] | null;
  category: string | null;
  usedFaqNos: number[];
  retrieved: { faqNo: number; category: string; question: string; similarity: number }[];
  error: string | null;
  elapsedMs: number;
};

const results: CaseResult[] = [];
const cases = loadCases();

describe("テスト会話 8件（実API）", () => {
  it("8件そろっている", () => {
    expect(cases.map((c) => c.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  for (const c of cases) {
    it(`No.${c.no} ${c.scenario}`, async () => {
      const nowIso = c.no === 7 ? CLOSED_NOW : OPEN_NOW;
      const now = new Date(nowIso);
      const question = toQuestion(c.message);
      const started = Date.now();
      const base = { no: c.no, scenario: c.scenario, question, now: nowIso, expected: c.expected };
      try {
        const r = await generateAiReply({ question, history: [], now });
        const checks = judge(c.no, r, now);
        results.push({
          ...base,
          pass: checks.every((x) => x.pass),
          checks,
          answer: r.answer,
          handoff: r.handoff,
          category: r.category,
          usedFaqNos: r.usedFaqNos,
          retrieved: r.retrieved.map((f) => ({
            faqNo: f.faqNo,
            category: f.category,
            question: f.question,
            similarity: Math.round(f.similarity * 1000) / 1000,
          })),
          error: null,
          elapsedMs: Date.now() - started,
        });
        expect(checks.filter((x) => !x.pass).map((x) => x.label)).toEqual([]);
      } catch (e) {
        if (!results.some((x) => x.no === c.no)) {
          // 例外の message にはキー等が含まれうるため、種類だけを記録する
          const name = e instanceof Error ? e.name : "unknown";
          results.push({
            ...base,
            pass: false,
            checks: [],
            answer: null,
            handoff: null,
            category: null,
            usedFaqNos: [],
            retrieved: [],
            error: name,
            elapsedMs: Date.now() - started,
          });
        }
        throw e;
      }
    });
  }

  afterAll(() => {
    results.sort((a, b) => a.no - b.no);
    mkdirSync(RESULTS_DIR, { recursive: true });
    const summary = {
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      embeddingModel: "text-embedding-3-small",
      passed: results.filter((r) => r.pass).length,
      total: results.length,
      results,
    };
    writeFileSync(path.join(RESULTS_DIR, "latest.json"), `${JSON.stringify(summary, null, 2)}\n`);
    writeFileSync(path.join(RESULTS_DIR, "latest.md"), toMarkdown(summary));
  });
});

function toMarkdown(s: { model: string; embeddingModel: string; passed: number; total: number; results: CaseResult[] }) {
  const esc = (t: string) => t.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  const lines = [
    "# テスト会話 8件の評価結果",
    "",
    `- 回答モデル: ${s.model}`,
    `- 埋め込みモデル: ${s.embeddingModel}`,
    `- 合格: **${s.passed} / ${s.total}**`,
    "",
    "| No | シナリオ | 合否 | handoff | used_faq_nos | 検索上位3件（類似度） |",
    "|---|---|---|---|---|---|",
    ...s.results.map(
      (r) =>
        `| ${r.no} | ${esc(r.scenario)} | ${r.pass ? "合格" : "不合格"} | ${
          r.handoff ? (r.handoff.needed ? `あり（${r.handoff.reason}）` : "なし") : "-"
        } | ${r.usedFaqNos.join(", ") || "-"} | ${r.retrieved.map((f) => `No.${f.faqNo} (${f.similarity})`).join(", ")} |`,
    ),
    "",
  ];
  for (const r of s.results) {
    lines.push(
      `## No.${r.no} ${r.scenario} — ${r.pass ? "合格" : "不合格"}`,
      "",
      `- 質問: ${r.question}`,
      `- 時刻: ${r.now}`,
      `- 期待: ${r.expected}`,
      `- カテゴリ: ${r.category ?? "-"}`,
      ...(r.error ? [`- エラー: ${r.error}`] : []),
      "",
      "**回答**",
      "",
      ...(r.answer ?? "（なし）").split("\n").map((l) => `> ${l}`),
      "",
      "**判定**",
      "",
      ...r.checks.map((c) => `- [${c.pass ? "x" : " "}] ${c.label}`),
      "",
      "**検索上位3件**",
      "",
      ...r.retrieved.map((f) => `1. No.${f.faqNo} [${f.category}] ${f.question} — ${f.similarity}`),
      "",
    );
  }
  return lines.join("\n");
}
