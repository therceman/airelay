import { randomUUID } from 'crypto';
import type { DetachedRuntimeEntry } from '../runtime/detached-registry';
import {
  checkProtocolParity,
  checkVersionParity,
  fetchControllerInfo,
  sendControllerRequest,
} from './session-ipc';
import {
  findDetachedBySessionKey,
  getDetachedEntry,
  isEntryReachable,
  isProcessAlive,
  removeDetachedEntry,
} from '../runtime/detached-registry';
import { CONTROLLER_PROTOCOL_VERSION } from '../utils/version';

const STOP_TIMEOUT_MS = 5000;
const STOP_CONFIRM_TIMEOUT_MS = 5000;
const STOP_POLL_INTERVAL_MS = 50;

async function waitForRegistryRemoval(runtimeId: string): Promise<boolean> {
  const deadline = Date.now() + STOP_CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!getDetachedEntry(runtimeId)) return true;
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_INTERVAL_MS));
  }
  return !getDetachedEntry(runtimeId);
}

async function waitForLegacyRuntimeExit(entry: DetachedRuntimeEntry): Promise<boolean> {
  const deadline = Date.now() + STOP_CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!getDetachedEntry(entry.runtimeId)) return true;
    if (!isProcessAlive(entry.runtimePid)) {
      if (!(await isEntryReachable(entry))) removeDetachedEntry(entry.runtimeId);
      return !getDetachedEntry(entry.runtimeId);
    }
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_INTERVAL_MS));
  }
  return !getDetachedEntry(entry.runtimeId);
}

async function stopLegacyRuntime(entry: DetachedRuntimeEntry): Promise<number> {
  if (!isProcessAlive(entry.runtimePid)) {
    if (!(await isEntryReachable(entry))) removeDetachedEntry(entry.runtimeId);
    if (!getDetachedEntry(entry.runtimeId)) {
      console.log(`Detached session ${entry.sessionKey} was already stopped.`);
      return 0;
    }
    console.error(`Error: Detached runtime ${entry.sessionKey} is no longer running.`);
    return 1;
  }

  process.kill(entry.runtimePid, 'SIGTERM');
  if (!(await waitForLegacyRuntimeExit(entry))) {
    console.error(
      `Stop was sent, but detached runtime ${entry.sessionKey} has not exited after ${STOP_CONFIRM_TIMEOUT_MS}ms.`
    );
    return 1;
  }

  console.log(`Stopped detached session ${entry.sessionKey}.`);
  return 0;
}

/** Request graceful shutdown of one identity-verified detached runtime. */
export async function stopCommand(sessionKeyOrRuntimeId: string): Promise<number> {
  const entry = findDetachedBySessionKey(sessionKeyOrRuntimeId);
  if (!entry) {
    console.error(`Error: Detached runtime not found: ${sessionKeyOrRuntimeId}`);
    console.error('Use "airelay detached" to list detached runtimes.');
    return 1;
  }

  try {
    const info = await fetchControllerInfo(entry.controllerEndpoint, 2000);
    const runtime = info.runtime;
    if (
      !runtime ||
      runtime.runtimeId !== entry.runtimeId ||
      runtime.controllerPid !== entry.runtimePid
    ) {
      console.error('Error: Controller identity does not match the detached runtime registry.');
      return 1;
    }

    if (
      info.controllerProtocolVersion !== undefined &&
      info.controllerProtocolVersion < CONTROLLER_PROTOCOL_VERSION
    ) {
      return await stopLegacyRuntime(entry);
    }

    const protocolParity = checkProtocolParity(info.controllerProtocolVersion);
    if (protocolParity.error) {
      console.error(`Error: ${protocolParity.error}`);
      return 1;
    }
    if (info.airelayVersion) {
      const versionParity = checkVersionParity(info.airelayVersion);
      if (versionParity.error) {
        console.error(`Error: ${versionParity.error}`);
        return 1;
      }
      for (const warning of versionParity.warnings) console.warn(`Warning: ${warning}`);
    }

    const response = await sendControllerRequest(
      entry.controllerEndpoint,
      { id: `stop-${randomUUID()}`, method: 'session.stop' },
      STOP_TIMEOUT_MS
    );
    if (response.type === 'error') {
      console.error(`Error: ${response.error?.message || 'Controller rejected stop request.'}`);
      return 1;
    }

    const result = response.data as { stopping?: unknown } | undefined;
    if (result?.stopping !== true) {
      console.error('Error: Controller returned an invalid stop response.');
      return 1;
    }

    if (!(await waitForRegistryRemoval(entry.runtimeId))) {
      console.error(
        `Stop was accepted, but detached runtime ${entry.sessionKey} has not exited after ${STOP_CONFIRM_TIMEOUT_MS}ms.`
      );
      return 1;
    }

    console.log(`Stopped detached session ${entry.sessionKey}.`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error stopping detached session ${entry.sessionKey}: ${message}`);
    return 1;
  }
}
