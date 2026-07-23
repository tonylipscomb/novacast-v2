import type { PairingService } from './pairingTypes.ts';

let configuredPairingService: PairingService | null = null;
let bootstrapPromise: Promise<unknown> | null = null;
let createPromise: Promise<unknown> | null = null;

export function getConfiguredPairingService() {
  return configuredPairingService;
}

export function setPairingServiceForTests(service: PairingService | null) {
  configuredPairingService = service;
  bootstrapPromise = null;
  createPromise = null;
}

export function getBootstrapPromise() {
  return bootstrapPromise;
}

export function setBootstrapPromise(promise: Promise<unknown> | null) {
  bootstrapPromise = promise;
}

export function getCreatePromise() {
  return createPromise;
}

export function setCreatePromise(promise: Promise<unknown> | null) {
  createPromise = promise;
}

export function resetPairingServiceLocksForTests() {
  bootstrapPromise = null;
  createPromise = null;
}
