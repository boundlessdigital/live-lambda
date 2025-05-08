// backend/handlers/my-url-handler.ts
async function handler(event) {
  console.log("Event received:", JSON.stringify(event, null, 2));
  const response_body = {
    message: "Hello from your Lambda Function URL!"
    // Uncomment to see the event in the response for debugging
    // input: event,
  };
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(response_body)
  };
}
export {
  handler
};
