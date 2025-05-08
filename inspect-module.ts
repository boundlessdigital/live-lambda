async function inspect() {
  console.log('Attempting to inspect @aws-sdk/credential-provider-node...');
  try {
    const credentialProviderModule = await import('@aws-sdk/credential-provider-node');
    console.log('\n--- Module Contents ---');
    console.log(credentialProviderModule);

    console.log('\n--- typeof fromNodeProviderChain ---');
    console.log(typeof credentialProviderModule.fromNodeProviderChain);

    if (credentialProviderModule.fromNodeProviderChain) {
      console.log('\nfromNodeProviderChain is present.');
    } else {
      console.log('\nfromNodeProviderChain is NOT present or undefined.');
    }

    console.log('\n--- All keys in the module ---');
    console.log(Object.keys(credentialProviderModule));

  } catch (error) {
    console.error('\nError during module inspection:', error);
  }
}

inspect();
