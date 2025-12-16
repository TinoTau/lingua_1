/**
 * 阶段 3.1：模型库服务 API 测试
 * 
 * 测试模型库服务的 HTTP API：
 * - GET /api/models
 * - GET /api/models/{model_id}
 * - GET /storage/models/{model_id}/{version}/{file_path}
 * - GET /api/model-usage/ranking
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import axios from 'axios';

const MODEL_HUB_URL = process.env.MODEL_HUB_URL || 'http://localhost:5000';

describe('模型库服务 API', () => {
  beforeAll(async () => {
    // 等待服务启动
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  describe('GET /api/models', () => {
    it('应该返回模型列表', async () => {
      const response = await axios.get(`${MODEL_HUB_URL}/api/models`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
    });

    it('应该返回正确格式的模型信息', async () => {
      const response = await axios.get(`${MODEL_HUB_URL}/api/models`);
      const models = response.data;
      
      if (models.length > 0) {
        const model = models[0];
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('name');
        expect(model).toHaveProperty('task');
        expect(model).toHaveProperty('languages');
        expect(model).toHaveProperty('default_version');
        expect(model).toHaveProperty('versions');
        expect(Array.isArray(model.versions)).toBe(true);
        
        if (model.versions.length > 0) {
          const version = model.versions[0];
          expect(version).toHaveProperty('version');
          expect(version).toHaveProperty('size_bytes');
          expect(version).toHaveProperty('files');
          expect(Array.isArray(version.files)).toBe(true);
        }
      }
    });
  });

  describe('GET /api/models/{model_id}', () => {
    it('应该返回指定模型的信息', async () => {
      // 先获取模型列表
      const listResponse = await axios.get(`${MODEL_HUB_URL}/api/models`);
      const models = listResponse.data;
      
      if (models.length > 0) {
        const modelId = models[0].id;
        const response = await axios.get(`${MODEL_HUB_URL}/api/models/${modelId}`);
        
        expect(response.status).toBe(200);
        expect(response.data.id).toBe(modelId);
      }
    });

    it('应该返回 404 如果模型不存在', async () => {
      await expect(
        axios.get(`${MODEL_HUB_URL}/api/models/non-existent-model`)
      ).rejects.toThrow();
    });
  });

  describe('GET /storage/models/{model_id}/{version}/{file_path}', () => {
    it('应该支持 Range 请求', async () => {
      // 先获取模型列表
      const listResponse = await axios.get(`${MODEL_HUB_URL}/api/models`);
      const models = listResponse.data;
      
      if (models.length > 0) {
        const model = models[0];
        const version = model.versions[0];
        
        if (version && version.files.length > 0) {
          const filePath = version.files[0].path;
          const response = await axios.get(
            `${MODEL_HUB_URL}/storage/models/${model.id}/${version.version}/${filePath}`,
            {
              headers: { Range: 'bytes=0-1023' },
              validateStatus: (status) => status === 206, // 接受 206 Partial Content
            }
          );
          
          expect(response.status).toBe(206);
          expect(response.headers['content-range']).toBeDefined();
          expect(response.headers['accept-ranges']).toBe('bytes');
        }
      }
    });

    it('应该防止路径遍历攻击', async () => {
      await expect(
        axios.get(`${MODEL_HUB_URL}/storage/models/test/1.0.0/../../../etc/passwd`)
      ).rejects.toThrow();
    });
  });

  describe('GET /api/model-usage/ranking', () => {
    it('应该返回热门模型排行', async () => {
      const response = await axios.get(`${MODEL_HUB_URL}/api/model-usage/ranking`);
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      
      if (response.data.length > 0) {
        const item = response.data[0];
        expect(item).toHaveProperty('model_id');
        expect(item).toHaveProperty('request_count');
        expect(item).toHaveProperty('rank');
      }
    });
  });
});

