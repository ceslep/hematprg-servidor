/** Bus de eventos interno (EventEmitter) para SSE y desacoplar módulos. */
'use strict';

import { EventEmitter } from 'node:events';

export class Bus extends EventEmitter {}
