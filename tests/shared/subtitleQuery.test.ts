import { describe, expect, it } from "vitest";
import { matchesSubtitleCode, subtitleCode, suggestSubtitleQuery } from "../../src/shared/subtitleQuery";

describe("subtitle release code identity", () => {
  it.each([
    ["SSIS-570 描述文字和演员姓名.mp4", "SSIS-570"],
    ["[site] ssis_570 中文说明 1080p.mkv", "SSIS-570"],
    ["ＳＳＩＳ－５７０ 标题.mp4", "SSIS-570"],
    ["SSIS570.mp4", "SSIS-570"],
    ["SSIS-2024 标题.mp4", "SSIS-2024"],
    ["FC2-PPV-1234567 描述.mp4", "FC2-PPV-1234567"]
  ])("uses the code in %s", (filename, code) => expect(suggestSubtitleQuery(filename)).toBe(code));
  it("keeps normal movie/episode queries and avoids years, codecs and partial numbers", () => {
    expect(suggestSubtitleQuery("Movie.2024.1080p.WEB-DL.mkv")).toBe("Movie 2024");
    expect(suggestSubtitleQuery("Show.S01E02.1080p.mkv")).toBe("Show S01E02");
    expect(subtitleCode("Movie-2024 WEB-1080 AAC-256 X265.mp4")).toBeNull();
    expect(subtitleCode("Room 104 1080p.mkv")).toBeNull();
    expect(subtitleCode("Studio.666.2022.mkv")).toBeNull();
    expect(subtitleCode("SSIS-5700")).toBe("SSIS-5700");
  });
  it("requires the exact code in a result rather than performer text or a number substring", () => {
    const item = (text: string) => ({ title: text, release: "网友上传", filename: text + ".srt" });
    expect(matchesSubtitleCode(item("演员姓名SSIS-037"), "SSIS-570")).toBe(false);
    expect(matchesSubtitleCode(item("SSIS-5700"), "SSIS-570")).toBe(false);
    expect(matchesSubtitleCode(item("演员姓名"), "SSIS-570")).toBe(false);
    expect(matchesSubtitleCode(item("ssis_570 chs"), "SSIS-570")).toBe(true);
    expect(matchesSubtitleCode(item("SSIS-0570"), "SSIS-570")).toBe(true);
  });
});
