import { fileURLToPath } from 'url';\nimport { dirname, join } from 'path';\nconst __filename = fileURLToPath(import.meta.url);\nconst __dirname = dirname(__filename);\nimport { Buffer } from 'buffer'; global.Buffer = Buffer;

// tunnel/src/lambda-proxy/handler.ts
var handler = async (event, context) => {
  console.log("LAMBDA PROXY (SIMPLIFIED): Event received:", JSON.stringify(event, null, 2));
  console.log("LAMBDA PROXY (SIMPLIFIED): Context received:", JSON.stringify(context, null, 2));
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "LAMBDA PROXY (SIMPLIFIED) WAS INVOKED!",
      invoked_function_arn: context.invokedFunctionArn
    }),
    headers: { "Content-Type": "application/json" }
  };
};
export {
  handler
};
