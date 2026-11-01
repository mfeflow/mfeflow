// Vectors copied from the AWS Signature Version 4 test suite, as vendored in awslabs/aws-c-auth
// (tests/aws-signing-test-suite/v4/<name>/): request.txt, header-canonical-request.txt and
// header-signature.txt. Credentials and scope come from that suite's context.json.

export const SUITE_CREDENTIALS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};

export const SUITE_SCOPE = { region: 'us-east-1', service: 'service' };
export const SUITE_DATE = new Date('2015-08-30T12:36:00Z');

export interface SuiteVector {
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  canonicalRequest: string;
  signature: string;
}

export const SUITE_VECTORS: SuiteVector[] = [
  {
    name: 'get-vanilla',
    method: 'GET',
    url: 'https://example.amazonaws.com/',
    headers: {},
    canonicalRequest: [
      'GET',
      '/',
      '',
      'host:example.amazonaws.com',
      'x-amz-date:20150830T123600Z',
      '',
      'host;x-amz-date',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ].join('\n'),
    signature: '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
  },
  {
    name: 'post-vanilla',
    method: 'POST',
    url: 'https://example.amazonaws.com/',
    headers: {},
    canonicalRequest: [
      'POST',
      '/',
      '',
      'host:example.amazonaws.com',
      'x-amz-date:20150830T123600Z',
      '',
      'host;x-amz-date',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ].join('\n'),
    signature: '5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b',
  },
  {
    name: 'get-vanilla-query-order-key-case',
    method: 'GET',
    url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1',
    headers: {},
    canonicalRequest: [
      'GET',
      '/',
      'Param1=value1&Param2=value2',
      'host:example.amazonaws.com',
      'x-amz-date:20150830T123600Z',
      '',
      'host;x-amz-date',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ].join('\n'),
    signature: 'b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500',
  },
  {
    name: 'get-header-value-trim',
    method: 'GET',
    url: 'https://example.amazonaws.com/',
    headers: { 'My-Header1': ' value1', 'My-Header2': ' "a   b   c"' },
    canonicalRequest: [
      'GET',
      '/',
      '',
      'host:example.amazonaws.com',
      'my-header1:value1',
      'my-header2:"a b c"',
      'x-amz-date:20150830T123600Z',
      '',
      'host;my-header1;my-header2;x-amz-date',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ].join('\n'),
    signature: 'acc3ed3afb60bb290fc8d2dd0098b9911fcaa05412b367055dee359757a9c736',
  },
];
