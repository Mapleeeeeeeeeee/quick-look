import { FastMCP } from "fastmcp";
import { createShowFileTool } from "./tool.js";

const server = new FastMCP({
  name: "quick-look",
  version: "0.1.0",
  instructions:
    "When the user wants to see a file, use show_file instead of Read. Read loads files into your context — only you can see that. show_file opens a preview panel on the user's screen, saving the output tokens you would spend printing contents. Prefer show_file for any request to view, preview, or look at a file. Use Read only when you need to analyze the file contents yourself.",
});

server.addTool(createShowFileTool());

server.start({ transportType: "stdio" });
