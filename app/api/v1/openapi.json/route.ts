import { NextResponse } from 'next/server'

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Answering Service Operator API',
    version: '1.0.0',
    description: 'REST API for operator and client integrations.',
  },
  servers: [{ url: '/api/v1' }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'API key issued via the operator portal. Include as: Authorization: Bearer <key>',
      },
    },
  },
  paths: {
    '/calls': {
      get: {
        summary: 'List call logs',
        operationId: 'listCalls',
        parameters: [
          {
            name: 'business_id',
            in: 'query',
            required: false,
            schema: { type: 'string', format: 'uuid' },
            description: 'Required for operator keys. Filter by business.',
          },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 25, maximum: 100 } },
        ],
        security: [{ bearerAuth: ['calls:read'] }],
        responses: {
          '200': { description: 'Paginated call list' },
          '400': { description: 'business_id required for operator key' },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/calls/{id}': {
      get: {
        summary: 'Get a single call',
        operationId: 'getCall',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        security: [{ bearerAuth: ['calls:read'] }],
        responses: {
          '200': { description: 'Call with message actions' },
          '404': { description: 'Not found' },
        },
      },
    },
    '/billing/estimate': {
      get: {
        summary: 'Current period billing estimate',
        operationId: 'getBillingEstimate',
        parameters: [
          {
            name: 'business_id',
            in: 'query',
            schema: { type: 'string', format: 'uuid' },
            description: 'Required for operator keys.',
          },
        ],
        security: [{ bearerAuth: ['billing:read'] }],
        responses: { '200': { description: 'BillingEstimate' } },
      },
    },
    '/billing/invoices': {
      get: {
        summary: 'Past invoices',
        operationId: 'listInvoices',
        parameters: [{ name: 'business_id', in: 'query', schema: { type: 'string', format: 'uuid' } }],
        security: [{ bearerAuth: ['billing:read'] }],
        responses: { '200': { description: 'Array of BillingInvoice' } },
      },
    },
    '/usage': {
      get: {
        summary: 'List usage periods',
        operationId: 'listUsagePeriods',
        security: [{ bearerAuth: ['billing:read'] }],
        responses: { '200': { description: 'Usage periods' } },
      },
      post: {
        summary: 'Ingest billing usage (operator key, usage:write scope)',
        operationId: 'ingestUsage',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
            'application/json': {
              schema: { type: 'array', items: { type: 'object' } },
            },
          },
        },
        security: [{ bearerAuth: ['usage:write'] }],
        responses: {
          '200': { description: 'All rows processed' },
          '207': { description: 'Some rows had errors' },
        },
      },
    },
    '/webhooks': {
      get: {
        summary: 'List webhook subscriptions',
        operationId: 'listWebhooks',
        security: [{ bearerAuth: ['webhooks:read'] }],
        responses: { '200': { description: 'Subscription list (secret excluded)' } },
      },
      post: {
        summary: 'Create webhook subscription',
        operationId: 'createWebhook',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url', 'topics'],
                properties: {
                  url: { type: 'string', format: 'uri' },
                  topics: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        security: [{ bearerAuth: ['webhooks:write'] }],
        responses: { '201': { description: 'Subscription created — secret returned once' } },
      },
    },
    '/webhooks/{id}': {
      delete: {
        summary: 'Delete webhook subscription',
        operationId: 'deleteWebhook',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        security: [{ bearerAuth: ['webhooks:write'] }],
        responses: { '204': { description: 'Deleted' } },
      },
    },
  },
}

export async function GET() {
  return NextResponse.json(spec, {
    headers: { 'Content-Type': 'application/json' },
  })
}
