import { GistRepository } from "../src/infrastructure/github/GistRepository";
import { IGistRepository } from "../src/core/application/ports/IGistRepository";

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("请设置 GITHUB_TOKEN 环境变量");
    process.exit(1);
  }

  const gistId = process.env.GIST_ID;
  if (!gistId) {
    console.error("请设置 GIST_ID 环境变量");
    process.exit(1);
  }

  console.log("开始验证 Gist API 优化...");
  const repo = new GistRepository();
  const auth = await repo.verifyToken(token);

  if (!auth) {
    console.error("Token 验证失败");
    process.exit(1);
  }
  console.log("Token 验证成功");

  console.log("1. 测试 getGistContent (GraphQL)...");
  try {
    const files = await repo.getGistContent(gistId);
    console.log("获取文件列表:", Object.keys(files));
    console.log(
      "文件内容示例 (nexus_index.json):",
      files["nexus_index.json"]?.content?.slice(0, 100) || "Not Found",
    );
    console.log("验证通过: 成功获取内容");
  } catch (e) {
    console.error("getGistContent 失败:", e);
  }

  console.log("\n2. 测试 getGistHistory (Diff/Commits)...");
  try {
    const history = await repo.getGistHistory(gistId);
    console.log(`获取历史记录条数: ${history.length}`);
    if (history.length > 0) {
      console.log("第一条历史:", history[0]);
    }
    console.log("验证通过: 成功获取历史");
  } catch (e) {
    console.error("getGistHistory 失败:", e);
  }
}

main().catch(console.error);
