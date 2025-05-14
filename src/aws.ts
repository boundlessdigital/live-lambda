import { Sha256 } from '@aws-crypto/sha256-js'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { defaultProvider } from '@aws-sdk/credential-provider-node'

import { HttpRequest } from '@aws-sdk/protocol-http'
import { SignatureV4 } from '@aws-sdk/signature-v4'

export type AwsProps = {
  awsRegion: string
  awsAccessKey?: string
  awsSecretKey?: string
  awsSessionToken?: string
}

export const getAuthHeaders = async (
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: unknown,
  props: AwsProps
): Promise<Record<string, string>> => {
  const providerChain = fromNodeProviderChain()

  const withTempEnv = async <R>(
    updateEnv: () => void,
    fn: () => Promise<R>
  ): Promise<R> => {
    const previousEnv = { ...process.env }

    try {
      updateEnv()
      return await fn()
    } finally {
      process.env = previousEnv
    }
  }

  const credentials = await withTempEnv(
    () => {
      // Temporarily set the appropriate environment variables if we've been
      // explicitly given credentials so that the credentials provider can
      // resolve them.
      //
      // Note: the environment provider is only not run first if the `AWS_PROFILE`
      // environment variable is set.
      // https://github.com/aws/aws-sdk-js-v3/blob/44a18a34b2c93feccdfcd162928d13e6dbdcaf30/packages/credential-provider-node/src/defaultProvider.ts#L49
      if (props.awsAccessKey) {
        process.env['AWS_ACCESS_KEY_ID'] = props.awsAccessKey
      }
      if (props.awsSecretKey) {
        process.env['AWS_SECRET_ACCESS_KEY'] = props.awsSecretKey
      }
      if (props.awsSessionToken) {
        process.env['AWS_SESSION_TOKEN'] = props.awsSessionToken
      }
    },
    () => providerChain()
  )

  const signer = new SignatureV4({
    service,
    region: props.awsRegion,
    credentials,
    sha256: Sha256
  })

  // The connection header may be stripped by a proxy somewhere, so the receiver
  // of this message may not see this header, so we remove it from the set of headers
  // that are signed.
  delete headers['connection']
  headers['host'] = url.hostname

  const request = new HttpRequest({
    method: method.toUpperCase(),
    protocol: url.protocol,
    path: url.pathname,
    headers,
    body: body
  })

  const signed = await signer.sign(request)
  return signed.headers
}
