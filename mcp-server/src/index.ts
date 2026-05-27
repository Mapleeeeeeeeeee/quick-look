import { FastMCP } from "fastmcp";
import { createShowFileTool } from "./tool.js";

const server = new FastMCP({
  name: "quick-look",
  version: "0.1.0",
});

server.addTool(createShowFileTool());

server.start({ transportType: "stdio" });
