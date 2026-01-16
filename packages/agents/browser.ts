import { BrowserManager } from "agent-browser/dist/browser.js";
import { executeCommand } from "agent-browser/dist/actions.js";
import TurndownService from "turndown";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export class BrowserAgent {
  private manager: BrowserManager;
  private turndown: TurndownService;

  constructor() {
    this.manager = new BrowserManager();
    this.turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
  }

  async fetchPageContent(url: string): Promise<{ title: string; content: string; markdown: string }> {
    try {
      if (!this.manager.isLaunched()) {
        await executeCommand({
          id: "launch",
          action: "launch",
          headless: true,
        }, this.manager);
      }

      // Navigate and wait for network to be idle
      await executeCommand({
        id: "nav",
        action: "navigate",
        url: url,
        waitUntil: "networkidle",
      } as any, this.manager);

      // Wait for rendering and potential redirects (WeChat needs this)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Get HTML for Readability
      const htmlResponse = await executeCommand({
        id: "content",
        action: "content",
      }, this.manager);

      const html = (htmlResponse as any).data?.html || "";

      let title = "";
      let content = "";
      let markdown = "";

      try {
        const doc = new JSDOM(html, { url });
        const reader = new Readability(doc.window.document);
        const article = reader.parse();

        if (article) {
          title = article.title || "";
          content = article.textContent || "";
          // Use Readability's clean HTML as base for markdown if possible
          markdown = article.content ? this.turndown.turndown(article.content) : "";
        }
      } catch (e) {
        console.error("Readability parsing failed", e);
      }

      // Fallback if Readability failed
      if (!content) {
        const titleResponse = await executeCommand({
          id: "title",
          action: "title",
        }, this.manager);

        const textResponse = await executeCommand({
          id: "gettext",
          action: "innertext",
          selector: "body",
        } as any, this.manager);

        title = title || (titleResponse as any).data?.title || "网页内容";
        content = (textResponse as any).data?.text || "";
        markdown = markdown || this.turndown.turndown(html);
      }

      // Final cleanup
      const cleanContent = content
        .replace(/\s+/g, " ")
        .replace(/\n+/g, "\n")
        .trim();

      return {
        title: title || "网页内容",
        content: cleanContent,
        markdown: markdown || cleanContent,
      };
    } catch (error) {
      console.error(`BrowserAgent error fetching ${url}:`, error);
      throw error;
    } finally {
      if (this.manager.isLaunched()) {
        await this.manager.close();
      }
    }
  }
}

export const browserAgent = new BrowserAgent();
