// Copyright 2020 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as types from '@opentelemetry/api';
import { TraceFlags } from '@opentelemetry/api';
import { ExportResult } from '@opentelemetry/base';
import { ConsoleLogger, LogLevel } from '@opentelemetry/core';
import { Resource } from '@opentelemetry/resources';
import { ReadableSpan } from '@opentelemetry/tracing';
import * as assert from 'assert';
import * as nock from 'nock';
import * as sinon from 'sinon';
import { TraceExporter } from '../src';

describe('Google Cloud Trace Exporter', () => {
  beforeEach(() => {
    process.env.GCLOUD_PROJECT = 'not-real';
    nock.disableNetConnect();
  });
  describe('constructor', () => {
    it('should construct an exporter', async () => {
      const exporter = new TraceExporter({
        credentials: {
          client_email: 'noreply@fake.example.com',
          private_key: 'this is a key',
        },
      });

      assert(exporter);
      return (exporter['_projectId'] as Promise<string>).then(id => {
        assert.deepStrictEqual(id, 'not-real');
      });
    });
  });

  describe('export', () => {
    let exporter: TraceExporter;
    let logger: ConsoleLogger;
    /* tslint:disable-next-line:no-any */
    let batchWrite: sinon.SinonSpy<[any, any], any>;
    let debug: sinon.SinonSpy;
    let info: sinon.SinonSpy;
    let warn: sinon.SinonSpy;
    let error: sinon.SinonSpy;
    let getClientShouldFail: boolean;
    let batchWriteShouldFail: boolean;

    beforeEach(() => {
      getClientShouldFail = false;
      batchWriteShouldFail = false;
      logger = new ConsoleLogger(LogLevel.ERROR);
      exporter = new TraceExporter({
        logger,
      });

      batchWrite = sinon.spy(
        /* tslint:disable-next-line:no-any */
        (spans: any, callback: (err: Error | null) => void): any => {
          if (batchWriteShouldFail) {
            callback(new Error('fail'));
          } else {
            callback(null);
          }
        }
      );

      sinon.replace(
        TraceExporter['_cloudTrace'].projects.traces,
        'batchWrite',
        /* tslint:disable-next-line:no-any */
        batchWrite as any
      );

      sinon.replace(exporter['_auth'], 'getClient', () => {
        if (getClientShouldFail) {
          throw new Error('fail');
        }
        /* tslint:disable-next-line:no-any */
        return {} as any;
      });

      debug = sinon.spy();
      info = sinon.spy();
      warn = sinon.spy();
      error = sinon.spy();
      sinon.replace(logger, 'debug', debug);
      sinon.replace(logger, 'info', info);
      sinon.replace(logger, 'warn', warn);
      sinon.replace(logger, 'error', error);
    });

    afterEach(() => {
      nock.restore();
      sinon.restore();
    });

    it('should export spans', async () => {
      const readableSpan: ReadableSpan = {
        attributes: {},
        duration: [32, 800000000],
        startTime: [1566156729, 709],
        endTime: [1566156731, 709],
        ended: true,
        events: [],
        kind: types.SpanKind.CLIENT,
        links: [],
        name: 'my-span',
        spanContext: {
          traceId: 'd4cda95b652f4a1592b449d5929fda1b',
          spanId: '6e0c63257de34c92',
          traceFlags: TraceFlags.NONE,
          isRemote: true,
        },
        status: { code: types.CanonicalCode.OK },
        resource: Resource.empty(),
      };

      const result = await new Promise((resolve, reject) => {
        exporter.export([readableSpan], result => {
          resolve(result);
        });
      });

      assert.deepStrictEqual(
        batchWrite.getCall(0).args[0].resource.spans[0].displayName.value,
        'my-span'
      );

      assert.deepStrictEqual(result, ExportResult.SUCCESS);
    });

    it('should return not retryable if authorization fails', async () => {
      const readableSpan: ReadableSpan = {
        attributes: {},
        duration: [32, 800000000],
        startTime: [1566156729, 709],
        endTime: [1566156731, 709],
        ended: true,
        events: [],
        kind: types.SpanKind.CLIENT,
        links: [],
        name: 'my-span',
        spanContext: {
          traceId: 'd4cda95b652f4a1592b449d5929fda1b',
          spanId: '6e0c63257de34c92',
          traceFlags: TraceFlags.NONE,
          isRemote: true,
        },
        status: { code: types.CanonicalCode.OK },
        resource: Resource.empty(),
      };

      getClientShouldFail = true;

      const result = await new Promise((resolve, reject) => {
        exporter.export([readableSpan], result => {
          resolve(result);
        });
      });

      assert(batchWrite.notCalled);
      assert(error.getCall(0).args[0].match(/authorize error: fail/));
      assert.deepStrictEqual(result, ExportResult.FAILED_NOT_RETRYABLE);
    });

    it('should return retryable if span writing fails', async () => {
      const readableSpan: ReadableSpan = {
        attributes: {},
        duration: [32, 800000000],
        startTime: [1566156729, 709],
        endTime: [1566156731, 709],
        ended: true,
        events: [],
        kind: types.SpanKind.CLIENT,
        links: [],
        name: 'my-span',
        spanContext: {
          traceId: 'd4cda95b652f4a1592b449d5929fda1b',
          spanId: '6e0c63257de34c92',
          traceFlags: TraceFlags.NONE,
          isRemote: true,
        },
        status: { code: types.CanonicalCode.OK },
        resource: Resource.empty(),
      };

      batchWriteShouldFail = true;

      const result = await new Promise((resolve, reject) => {
        exporter.export([readableSpan], result => {
          resolve(result);
        });
      });

      assert.deepStrictEqual(result, ExportResult.FAILED_RETRYABLE);
    });

    it('should return not retryable if project id missing', async () => {
      const readableSpan: ReadableSpan = {
        attributes: {},
        duration: [32, 800000000],
        startTime: [1566156729, 709],
        endTime: [1566156731, 709],
        ended: true,
        events: [],
        kind: types.SpanKind.CLIENT,
        links: [],
        name: 'my-span',
        spanContext: {
          traceId: 'd4cda95b652f4a1592b449d5929fda1b',
          spanId: '6e0c63257de34c92',
          traceFlags: TraceFlags.NONE,
          isRemote: true,
        },
        status: { code: types.CanonicalCode.OK },
        resource: Resource.empty(),
      };

      await exporter['_projectId'];
      exporter['_projectId'] = undefined;

      const result = await new Promise((resolve, reject) => {
        exporter.export([readableSpan], result => {
          resolve(result);
        });
      });

      assert.deepStrictEqual(result, ExportResult.FAILED_NOT_RETRYABLE);
    });
  });
});
