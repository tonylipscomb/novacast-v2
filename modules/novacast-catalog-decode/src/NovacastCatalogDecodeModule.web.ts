export default {
  async isNativeDecodeAvailable() {
    return false;
  },
  async startDecodeJob() {
    throw new Error('NovacastCatalogDecode is Android-only');
  },
  async pullDecodeBatch() {
    return { jobId: '', items: [], done: true, error: 'unsupported_platform' };
  },
  async cancelDecodeJob(jobId: string) {
    return { cancelled: false, jobId };
  },
};
