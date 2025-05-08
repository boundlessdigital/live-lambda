import { createRequire } from 'module'; const require = createRequire(import.meta.url);

// tunnel/src/lambda-proxy/handler.ts
import { HttpRequest } from "@aws-sdk/protocol-http";
import { SignatureV4 } from "@aws-sdk/signature-v4";

// node_modules/.pnpm/tslib@2.8.1/node_modules/tslib/tslib.es6.mjs
function __awaiter(thisArg, _arguments, P, generator) {
  function adopt(value) {
    return value instanceof P ? value : new P(function(resolve) {
      resolve(value);
    });
  }
  return new (P || (P = Promise))(function(resolve, reject) {
    function fulfilled(value) {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    }
    function rejected(value) {
      try {
        step(generator["throw"](value));
      } catch (e) {
        reject(e);
      }
    }
    function step(result) {
      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
    }
    step((generator = generator.apply(thisArg, _arguments || [])).next());
  });
}
function __generator(thisArg, body) {
  var _ = { label: 0, sent: function() {
    if (t[0] & 1)
      throw t[1];
    return t[1];
  }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
  return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() {
    return this;
  }), g;
  function verb(n) {
    return function(v) {
      return step([n, v]);
    };
  }
  function step(op) {
    if (f)
      throw new TypeError("Generator is already executing.");
    while (g && (g = 0, op[0] && (_ = 0)), _)
      try {
        if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done)
          return t;
        if (y = 0, t)
          op = [op[0] & 2, t.value];
        switch (op[0]) {
          case 0:
          case 1:
            t = op;
            break;
          case 4:
            _.label++;
            return { value: op[1], done: false };
          case 5:
            _.label++;
            y = op[1];
            op = [0];
            continue;
          case 7:
            op = _.ops.pop();
            _.trys.pop();
            continue;
          default:
            if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
              _ = 0;
              continue;
            }
            if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
              _.label = op[1];
              break;
            }
            if (op[0] === 6 && _.label < t[1]) {
              _.label = t[1];
              t = op;
              break;
            }
            if (t && _.label < t[2]) {
              _.label = t[2];
              _.ops.push(op);
              break;
            }
            if (t[2])
              _.ops.pop();
            _.trys.pop();
            continue;
        }
        op = body.call(thisArg, _);
      } catch (e) {
        op = [6, e];
        y = 0;
      } finally {
        f = t = 0;
      }
    if (op[0] & 5)
      throw op[1];
    return { value: op[0] ? op[1] : void 0, done: true };
  }
}

// node_modules/.pnpm/@aws-crypto+sha256-js@5.2.0/node_modules/@aws-crypto/sha256-js/build/module/constants.js
var BLOCK_SIZE = 64;
var DIGEST_LENGTH = 32;
var KEY = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var INIT = [
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
];
var MAX_HASHABLE_LENGTH = Math.pow(2, 53) - 1;

// node_modules/.pnpm/@aws-crypto+sha256-js@5.2.0/node_modules/@aws-crypto/sha256-js/build/module/RawSha256.js
var RawSha256 = (
  /** @class */
  function() {
    function RawSha2562() {
      this.state = Int32Array.from(INIT);
      this.temp = new Int32Array(64);
      this.buffer = new Uint8Array(64);
      this.bufferLength = 0;
      this.bytesHashed = 0;
      this.finished = false;
    }
    RawSha2562.prototype.update = function(data) {
      if (this.finished) {
        throw new Error("Attempted to update an already finished hash.");
      }
      var position = 0;
      var byteLength = data.byteLength;
      this.bytesHashed += byteLength;
      if (this.bytesHashed * 8 > MAX_HASHABLE_LENGTH) {
        throw new Error("Cannot hash more than 2^53 - 1 bits");
      }
      while (byteLength > 0) {
        this.buffer[this.bufferLength++] = data[position++];
        byteLength--;
        if (this.bufferLength === BLOCK_SIZE) {
          this.hashBuffer();
          this.bufferLength = 0;
        }
      }
    };
    RawSha2562.prototype.digest = function() {
      if (!this.finished) {
        var bitsHashed = this.bytesHashed * 8;
        var bufferView = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
        var undecoratedLength = this.bufferLength;
        bufferView.setUint8(this.bufferLength++, 128);
        if (undecoratedLength % BLOCK_SIZE >= BLOCK_SIZE - 8) {
          for (var i = this.bufferLength; i < BLOCK_SIZE; i++) {
            bufferView.setUint8(i, 0);
          }
          this.hashBuffer();
          this.bufferLength = 0;
        }
        for (var i = this.bufferLength; i < BLOCK_SIZE - 8; i++) {
          bufferView.setUint8(i, 0);
        }
        bufferView.setUint32(BLOCK_SIZE - 8, Math.floor(bitsHashed / 4294967296), true);
        bufferView.setUint32(BLOCK_SIZE - 4, bitsHashed);
        this.hashBuffer();
        this.finished = true;
      }
      var out = new Uint8Array(DIGEST_LENGTH);
      for (var i = 0; i < 8; i++) {
        out[i * 4] = this.state[i] >>> 24 & 255;
        out[i * 4 + 1] = this.state[i] >>> 16 & 255;
        out[i * 4 + 2] = this.state[i] >>> 8 & 255;
        out[i * 4 + 3] = this.state[i] >>> 0 & 255;
      }
      return out;
    };
    RawSha2562.prototype.hashBuffer = function() {
      var _a = this, buffer = _a.buffer, state = _a.state;
      var state0 = state[0], state1 = state[1], state2 = state[2], state3 = state[3], state4 = state[4], state5 = state[5], state6 = state[6], state7 = state[7];
      for (var i = 0; i < BLOCK_SIZE; i++) {
        if (i < 16) {
          this.temp[i] = (buffer[i * 4] & 255) << 24 | (buffer[i * 4 + 1] & 255) << 16 | (buffer[i * 4 + 2] & 255) << 8 | buffer[i * 4 + 3] & 255;
        } else {
          var u = this.temp[i - 2];
          var t1_1 = (u >>> 17 | u << 15) ^ (u >>> 19 | u << 13) ^ u >>> 10;
          u = this.temp[i - 15];
          var t2_1 = (u >>> 7 | u << 25) ^ (u >>> 18 | u << 14) ^ u >>> 3;
          this.temp[i] = (t1_1 + this.temp[i - 7] | 0) + (t2_1 + this.temp[i - 16] | 0);
        }
        var t1 = (((state4 >>> 6 | state4 << 26) ^ (state4 >>> 11 | state4 << 21) ^ (state4 >>> 25 | state4 << 7)) + (state4 & state5 ^ ~state4 & state6) | 0) + (state7 + (KEY[i] + this.temp[i] | 0) | 0) | 0;
        var t2 = ((state0 >>> 2 | state0 << 30) ^ (state0 >>> 13 | state0 << 19) ^ (state0 >>> 22 | state0 << 10)) + (state0 & state1 ^ state0 & state2 ^ state1 & state2) | 0;
        state7 = state6;
        state6 = state5;
        state5 = state4;
        state4 = state3 + t1 | 0;
        state3 = state2;
        state2 = state1;
        state1 = state0;
        state0 = t1 + t2 | 0;
      }
      state[0] += state0;
      state[1] += state1;
      state[2] += state2;
      state[3] += state3;
      state[4] += state4;
      state[5] += state5;
      state[6] += state6;
      state[7] += state7;
    };
    return RawSha2562;
  }()
);

// node_modules/.pnpm/@smithy+util-buffer-from@2.2.0/node_modules/@smithy/util-buffer-from/dist-es/index.js
import { Buffer as Buffer2 } from "buffer";
var fromString = (input, encoding) => {
  if (typeof input !== "string") {
    throw new TypeError(`The "input" argument must be of type string. Received type ${typeof input} (${input})`);
  }
  return encoding ? Buffer2.from(input, encoding) : Buffer2.from(input);
};

// node_modules/.pnpm/@smithy+util-utf8@2.3.0/node_modules/@smithy/util-utf8/dist-es/fromUtf8.js
var fromUtf8 = (input) => {
  const buf = fromString(input, "utf8");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength / Uint8Array.BYTES_PER_ELEMENT);
};

// node_modules/.pnpm/@aws-crypto+util@5.2.0/node_modules/@aws-crypto/util/build/module/convertToBuffer.js
var fromUtf82 = typeof Buffer !== "undefined" && Buffer.from ? function(input) {
  return Buffer.from(input, "utf8");
} : fromUtf8;
function convertToBuffer(data) {
  if (data instanceof Uint8Array)
    return data;
  if (typeof data === "string") {
    return fromUtf82(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength / Uint8Array.BYTES_PER_ELEMENT);
  }
  return new Uint8Array(data);
}

// node_modules/.pnpm/@aws-crypto+util@5.2.0/node_modules/@aws-crypto/util/build/module/isEmptyData.js
function isEmptyData(data) {
  if (typeof data === "string") {
    return data.length === 0;
  }
  return data.byteLength === 0;
}

// node_modules/.pnpm/@aws-crypto+sha256-js@5.2.0/node_modules/@aws-crypto/sha256-js/build/module/jsSha256.js
var Sha256 = (
  /** @class */
  function() {
    function Sha2562(secret) {
      this.secret = secret;
      this.hash = new RawSha256();
      this.reset();
    }
    Sha2562.prototype.update = function(toHash) {
      if (isEmptyData(toHash) || this.error) {
        return;
      }
      try {
        this.hash.update(convertToBuffer(toHash));
      } catch (e) {
        this.error = e;
      }
    };
    Sha2562.prototype.digestSync = function() {
      if (this.error) {
        throw this.error;
      }
      if (this.outer) {
        if (!this.outer.finished) {
          this.outer.update(this.hash.digest());
        }
        return this.outer.digest();
      }
      return this.hash.digest();
    };
    Sha2562.prototype.digest = function() {
      return __awaiter(this, void 0, void 0, function() {
        return __generator(this, function(_a) {
          return [2, this.digestSync()];
        });
      });
    };
    Sha2562.prototype.reset = function() {
      this.hash = new RawSha256();
      if (this.secret) {
        this.outer = new RawSha256();
        var inner = bufferFromSecret(this.secret);
        var outer = new Uint8Array(BLOCK_SIZE);
        outer.set(inner);
        for (var i = 0; i < BLOCK_SIZE; i++) {
          inner[i] ^= 54;
          outer[i] ^= 92;
        }
        this.hash.update(inner);
        this.outer.update(outer);
        for (var i = 0; i < inner.byteLength; i++) {
          inner[i] = 0;
        }
      }
    };
    return Sha2562;
  }()
);
function bufferFromSecret(secret) {
  var input = convertToBuffer(secret);
  if (input.byteLength > BLOCK_SIZE) {
    var bufferHash = new RawSha256();
    bufferHash.update(input);
    input = bufferHash.digest();
  }
  var buffer = new Uint8Array(BLOCK_SIZE);
  buffer.set(input);
  return buffer;
}

// tunnel/src/lambda-proxy/handler.ts
import { URL } from "url";
var region = process.env.AWS_REGION || "us-west-1";
var appsync_event_api_url = process.env.APPSYNC_EVENT_API_URL;
var appsync_channel_namespace = process.env.APPSYNC_CHANNEL_NAMESPACE;
var original_function_arn = process.env.ORIGINAL_FUNCTION_ARN;
var signer = new SignatureV4({
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN
  },
  region,
  service: "appsync",
  sha256: Sha256
});
var handler = async (event) => {
  console.log("LAMBDA PROXY (START): Received event:", JSON.stringify(event, null, 2));
  console.log("LAMBDA PROXY (ENV): Variables:", JSON.stringify({
    AWS_REGION: region,
    APPSYNC_EVENT_API_URL: appsync_event_api_url,
    APPSYNC_CHANNEL_NAMESPACE: appsync_channel_namespace,
    ORIGINAL_FUNCTION_ARN: original_function_arn,
    AWS_ACCESS_KEY_ID_SET: !!process.env.AWS_ACCESS_KEY_ID
    // Check if access key is set
  }, null, 2));
  if (!appsync_event_api_url || !appsync_channel_namespace || !original_function_arn) {
    console.error("LAMBDA PROXY (ERROR): Missing critical environment variables.");
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "LAMBDA PROXY: Internal configuration error - missing env vars." })
    };
  }
  try {
    const parsed_url = new URL(appsync_event_api_url);
    console.log("LAMBDA PROXY (URL PARSE): Parsed APPSYNC_EVENT_API_URL:", JSON.stringify(parsed_url, null, 2));
    const channel_name_for_body = `${appsync_channel_namespace}-requests-${Date.now()}`;
    console.log("LAMBDA PROXY (CHANNEL NAME): Constructed channel_name_for_body:", channel_name_for_body);
    const request_body_object = {
      channel: channel_name_for_body,
      events: [
        JSON.stringify({
          // Inner event payload is stringified
          original_request_context: event.requestContext,
          original_request_body: event.body,
          // event.body is already a string or undefined
          original_function_arn
        })
      ]
    };
    console.log("LAMBDA PROXY (REQUEST BODY PRE-STRINGIFY): request_body_object:", JSON.stringify(request_body_object, null, 2));
    const stringified_request_body = JSON.stringify(request_body_object);
    console.log("LAMBDA PROXY (REQUEST BODY STRINGIFIED): stringified_request_body:", stringified_request_body);
    const request_to_sign = new HttpRequest({
      method: "POST",
      protocol: parsed_url.protocol,
      hostname: parsed_url.hostname,
      path: parsed_url.pathname,
      headers: {
        "Content-Type": "application/json",
        "host": parsed_url.hostname,
        "Content-Length": Buffer.byteLength(stringified_request_body).toString()
      },
      body: stringified_request_body
    });
    console.log("LAMBDA PROXY (PRE-SIGN): request_to_sign object:", JSON.stringify(request_to_sign, null, 2));
    const signed_request = await signer.sign(request_to_sign);
    console.log("LAMBDA PROXY (POST-SIGN): Signed request headers:", JSON.stringify(signed_request.headers, null, 2));
    console.log("LAMBDA PROXY (POST-SIGN): Signed request body (full):", signed_request.body?.toString());
    console.log(
      `LAMBDA PROXY (FETCH): Publishing to AppSync. Target URL: ${appsync_event_api_url}, Method: ${signed_request.method}`
    );
    const fetch_response = await fetch(appsync_event_api_url, {
      method: signed_request.method,
      // fetch expects string for method
      headers: signed_request.headers,
      // Type assertion for HeadersInit
      body: signed_request.body
    });
    const response_status = fetch_response.status;
    const response_status_text = fetch_response.statusText;
    const response_body_text = await fetch_response.text();
    console.log("LAMBDA PROXY (APPSYNC RESPONSE): Status:", response_status, response_status_text);
    console.log("LAMBDA PROXY (APPSYNC RESPONSE): Body:", response_body_text);
    if (fetch_response.ok) {
      console.log("LAMBDA PROXY (SUCCESS): Successfully published event to AppSync.");
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "LAMBDA PROXY: Event processed and forwarded to AppSync." })
      };
    } else {
      console.error("LAMBDA PROXY (FAILURE): Failed to publish event to AppSync.");
      return {
        statusCode: 502,
        // Bad Gateway, indicating an issue with the upstream service (AppSync)
        body: JSON.stringify({
          message: "LAMBDA PROXY: Event received, but failed to publish to AppSync.",
          appsync_status: response_status,
          appsync_response: response_body_text
        })
      };
    }
  } catch (error) {
    console.error("LAMBDA PROXY (UNHANDLED ERROR): Error during event processing:", JSON.stringify({
      message: error.message,
      stack: error.stack,
      error_object: JSON.stringify(error, Object.getOwnPropertyNames(error))
      // Serialize more error details
    }, null, 2));
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "LAMBDA PROXY: Internal server error during event processing.",
        error_message: error.message
      })
    };
  }
};
export {
  handler
};
//# sourceMappingURL=index.mjs.map
