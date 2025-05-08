// ../tunnel/dist/lambda-proxy/handler.js
var handler = async (event, context) => {
  console.log("LAMBDA PROXY: Event received:", JSON.stringify(event, null, 2));
  console.log("LAMBDA PROXY: Context received:", JSON.stringify(context, null, 2));
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Hello from the LAMBDA PROXY! Your request has been tunnelled (conceptually).",
      original_event: event
      // Echo back the event for debugging purposes
    }),
    headers: {
      "Content-Type": "application/json"
    }
  };
};
export {
  handler
};
//# sourceMappingURL=index.mjs.map
