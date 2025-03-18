import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import readline from "readline/promises";
import dotenv from "dotenv";
import OpenAI from "openai";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
dotenv.config();
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is not set");
}
class MCPClient {
    mcp;
    transport = null;
    tools = [];
    openai;
    constructor() {
        this.openai = new OpenAI({
            baseURL: "https://api.deepseek.com",
            apiKey: process.env.DEEPSEEK_API_KEY,
        });
        this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" }, {
            capabilities: {},
        });
    }
    async connectToServer() {
        try {
            this.transport = new SSEClientTransport(new URL(`http://localhost:8088/sse`));
            await this.mcp.connect(this.transport);
            const toolsResult = await this.mcp.listTools();
            this.tools = toolsResult.tools.map((tool) => {
                return {
                    type: "function",
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema,
                    },
                };
            });
            console.log("Connected to server with tools:", this.tools.map((tool) => tool.function.name));
        }
        catch (e) {
            console.log("Failed to connect to MCP server: ", e);
            throw e;
        }
    }
    async processQuery(query) {
        const messages = [
            {
                role: "user",
                content: query,
            },
        ];
        // console.log("....... Tools: ", this.tools);
        const response = await this.openai.chat.completions.create({
            model: "deepseek-chat",
            messages,
            tools: this.tools,
            stream: true,
        });
        const finalText = [];
        const toolResults = [];
        let text = "";
        let toolCalls = [];
        let tmpToolCalls = [];
        for await (const chunk of response) {
            const toolCalls = chunk.choices[0].delta.tool_calls;
            // console.log(">>>", chunk.choices[0]);
            if (toolCalls && toolCalls.length > 0) {
                if (toolCalls[0].id) {
                    tmpToolCalls[toolCalls[0].index] = {
                        id: toolCalls[0].id,
                        type: toolCalls[0].type,
                        function: {
                            name: toolCalls[0].function?.name,
                            arguments: toolCalls[0].function?.arguments,
                        },
                    };
                }
                else {
                    tmpToolCalls[toolCalls[0].index] = {
                        ...tmpToolCalls[toolCalls[0].index],
                        function: {
                            ...tmpToolCalls[toolCalls[0].index].function,
                            arguments: `${tmpToolCalls[toolCalls[0].index].function.arguments}${toolCalls[0].function?.arguments}`,
                        },
                    };
                }
            }
            else {
                // console.log("....... Chunk 222: ", chunk.choices[0].delta.content);
            }
            if (chunk.choices[0].finish_reason === "tool_calls") {
                // for (const toolCall of chunk.choices[0].delta.tool_calls ?? []) {
                //   if (toolCall.type !== "function") {
                //     continue;
                //   }
                //   const toolName = toolCall.function.name;
                //   const toolArgs = JSON.parse(toolCall.function.arguments);
                //   const result = await this.mcp.callTool({
                //     name: toolName,
                //     arguments: toolArgs,
                //   });
                //   toolResults.push(result);
                //   finalText.push(
                //     `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`
                //   );
                //   messages.push({
                //     role: "assistant",
                //     content: "",
                //     tool_calls: [toolCall],
                //   });
                //   (result.content as any[]).forEach((content: any) => {
                //     if (content.type === "text") {
                //       messages.push({
                //         role: "tool",
                //         content: content.text,
                //         tool_call_id: toolCall.id,
                //       });
                //     }
                //   });
                //   const response2 = await this.openai.chat.completions.create({
                //     model: "deepseek-chat",
                //     messages,
                //     stream: true,
                //   });
                //   finalText.push(response2.choices[0].message.content);
                // }
            }
            else {
                if (chunk.choices[0].delta && chunk.choices[0].delta.content) {
                    text += chunk.choices[0].delta.content;
                    process.stdout.write(`\r\x1B[K${text}`);
                }
            }
        }
        // tmpToolCalls.forEach((toolCall) => {
        //   toolCalls.push({
        //     ...toolCall,
        //     function: {
        //       ...toolCall.function,
        //       arguments: JSON.parse(toolCall.function.arguments),
        //     },
        //   });
        // });
        if (tmpToolCalls && tmpToolCalls.length > 0) {
            for (const toolCall of tmpToolCalls) {
                if (toolCall.type !== "function") {
                    continue;
                }
                const toolName = toolCall.function.name;
                const toolArgs = JSON.parse(toolCall.function.arguments);
                console.log(`[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`);
                const result = await this.mcp.callTool({
                    name: toolName,
                    arguments: toolArgs,
                });
                console.log("......result: ", result);
                messages.push({
                    role: "assistant",
                    content: "",
                    tool_calls: [toolCall],
                });
                result.content.forEach((content) => {
                    if (content.type === "text") {
                        messages.push({
                            role: "tool",
                            content: content.text,
                            tool_call_id: toolCall.id,
                        });
                    }
                });
                // console.log("....... Messages 1: ", JSON.stringify(messages, null, 2));
                const response2 = await this.openai.chat.completions.create({
                    model: "deepseek-chat",
                    messages,
                    stream: true,
                    tool_choice: "required",
                });
                let tmpText = "";
                for await (const ck of response2) {
                    if (ck.choices[0].finish_reason !== "stop") {
                        // console.log("......ck: ", ck.choices[0]);
                        tmpText += ck.choices[0].delta.content;
                        // console.log("......tmpText: ", tmpText);
                        // process.stdout.write(`\r${tmpText}`);
                    }
                }
            }
        }
        // if (
        //   response.choices[0].message.tool_calls &&
        //   response.choices[0].message.tool_calls.length > 0
        // ) {
        //   for (const toolCall of response.choices[0].message.tool_calls) {
        //     if (toolCall.type !== "function") {
        //       continue;
        //     }
        //     const toolName = toolCall.function.name;
        //     const toolArgs = JSON.parse(toolCall.function.arguments);
        //     const result = await this.mcp.callTool({
        //       name: toolName,
        //       arguments: toolArgs,
        //     });
        //     toolResults.push(result);
        //     finalText.push(
        //       `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`
        //     );
        //     messages.push({
        //       role: "assistant",
        //       content: "",
        //       tool_calls: [toolCall],
        //     });
        //     (result.content as any[]).forEach((content: any) => {
        //       if (content.type === "text") {
        //         messages.push({
        //           role: "tool",
        //           content: content.text,
        //           tool_call_id: toolCall.id,
        //         });
        //       }
        //     });
        //     const response2 = await this.openai.chat.completions.create({
        //       model: "deepseek-chat",
        //       messages,
        //       stream: true,
        //     });
        //     finalText.push(response2.choices[0].message.content);
        //   }
        // } else {
        //   finalText.push(response.choices[0].message.content);
        // }
        return finalText.join("\n");
    }
    async chatLoop() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        try {
            console.log("\nMCP Client Started!");
            console.log("Type your queries or 'quit' to exit.");
            while (true) {
                const message = await rl.question("\nQuery: ");
                if (message.toLowerCase() === "quit") {
                    break;
                }
                const response = await this.processQuery(message);
                console.log(response);
            }
        }
        finally {
            rl.close();
        }
    }
    async cleanup() {
        await this.mcp.close();
    }
}
async function main() {
    // if (process.argv.length < 3) {
    //   console.log("Usage: node index.ts <path_to_server_script>");
    //   return;
    // }
    const mcpClient = new MCPClient();
    try {
        await mcpClient.connectToServer();
        await mcpClient.chatLoop();
    }
    finally {
        await mcpClient.cleanup();
        process.exit(0);
    }
}
main();
