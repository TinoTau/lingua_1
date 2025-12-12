import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

export interface ModelMetadata {
  model_id: string;
  model_type: 'ASR' | 'NMT' | 'TTS' | 'VAD';
  name: string;
  version: string;
  src_lang?: string;
  tgt_lang?: string;
  dialect?: string;
  size_bytes: number;
  download_url: string;
  sha256: string;
  status: 'Stable' | 'Beta' | 'Deprecated';
}

export interface InstalledModel {
  model_id: string;
  installed_at: Date;
  version: string;
  path: string;
}

export class ModelManager {
  private modelHubUrl: string;
  private modelsDir: string;
  private installedModels: Map<string, InstalledModel> = new Map();

  constructor() {
    this.modelHubUrl = process.env.MODEL_HUB_URL || 'http://localhost:5000';
    
    // 优先使用非 C 盘路径
    let userData: string;
    if (process.env.USER_DATA) {
      userData = process.env.USER_DATA;
    } else if (typeof app !== 'undefined') {
      const defaultUserData = app.getPath('userData');
      // 如果默认路径在 C 盘，尝试使用其他盘
      if (defaultUserData.startsWith('C:\\') || defaultUserData.startsWith('C:/')) {
        // 尝试使用 D 盘或其他可用盘
        const alternativePath = this.findAlternativePath();
        userData = alternativePath || defaultUserData;
      } else {
        userData = defaultUserData;
      }
    } else {
      userData = './user-data';
    }
    
    this.modelsDir = path.join(userData, 'models');
    this.loadInstalledModels();
  }

  private findAlternativePath(): string | null {
    // 尝试查找非 C 盘的可用路径
    // Windows: 尝试 D:, E:, F: 等
    // 其他系统: 使用用户主目录
    if (os.platform() === 'win32') {
      const fs = require('fs');
      const drives = ['D', 'E', 'F', 'G', 'H'];
      for (const drive of drives) {
        const testPath = `${drive}:\\LinguaNode`;
        try {
          if (!fs.existsSync(testPath)) {
            fs.mkdirSync(testPath, { recursive: true });
          }
          return testPath;
        } catch {
          // 继续尝试下一个盘
        }
      }
    }
    return null;
  }

  private async loadInstalledModels(): Promise<void> {
    try {
      await fs.mkdir(this.modelsDir, { recursive: true });
      const manifestPath = path.join(this.modelsDir, 'manifest.json');
      
      if (await this.fileExists(manifestPath)) {
        const content = await fs.readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(content);
        
        for (const [modelId, model] of Object.entries(manifest)) {
          this.installedModels.set(modelId, model as InstalledModel);
        }
      }
    } catch (error) {
      console.error('加载已安装模型列表失败:', error);
    }
  }

  private async saveInstalledModels(): Promise<void> {
    try {
      const manifestPath = path.join(this.modelsDir, 'manifest.json');
      const manifest: Record<string, InstalledModel> = {};
      
      for (const [modelId, model] of this.installedModels.entries()) {
        manifest[modelId] = model;
      }
      
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    } catch (error) {
      console.error('保存已安装模型列表失败:', error);
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<ModelMetadata[]> {
    try {
      const response = await axios.get(`${this.modelHubUrl}/api/v1/models`);
      return response.data.models || [];
    } catch (error) {
      console.error('获取可用模型列表失败:', error);
      return [];
    }
  }

  getInstalledModels(): InstalledModel[] {
    return Array.from(this.installedModels.values());
  }

  async installModel(modelId: string): Promise<boolean> {
    try {
      // 获取模型元数据
      const availableModels = await this.getAvailableModels();
      const model = availableModels.find(m => m.model_id === modelId);
      
      if (!model) {
        console.error('模型不存在:', modelId);
        return false;
      }

      // 检查是否已安装
      if (this.installedModels.has(modelId)) {
        console.log('模型已安装:', modelId);
        return true;
      }

      // 下载模型
      const modelPath = path.join(this.modelsDir, modelId);
      await fs.mkdir(modelPath, { recursive: true });

      console.log('开始下载模型:', modelId);
      const response = await axios.get(model.download_url, {
        responseType: 'arraybuffer',
        onDownloadProgress: (progressEvent) => {
          const percent = (progressEvent.loaded / model.size_bytes) * 100;
          console.log(`下载进度: ${percent.toFixed(2)}%`);
        },
      });

      // 保存模型文件
      const filePath = path.join(modelPath, 'model.bin');
      await fs.writeFile(filePath, Buffer.from(response.data));

      // 验证 SHA256
      const hash = crypto.createHash('sha256');
      hash.update(Buffer.from(response.data));
      const calculatedHash = hash.digest('hex');

      if (calculatedHash !== model.sha256) {
        console.error('模型文件校验失败');
        await fs.rm(modelPath, { recursive: true });
        return false;
      }

      // 保存模型元数据
      const installedModel: InstalledModel = {
        model_id: modelId,
        installed_at: new Date(),
        version: model.version,
        path: modelPath,
      };

      this.installedModels.set(modelId, installedModel);
      await this.saveInstalledModels();

      console.log('模型安装成功:', modelId);
      return true;
    } catch (error) {
      console.error('安装模型失败:', error);
      return false;
    }
  }

  async uninstallModel(modelId: string): Promise<boolean> {
    try {
      const installedModel = this.installedModels.get(modelId);
      if (!installedModel) {
        return false;
      }

      // 删除模型文件
      await fs.rm(installedModel.path, { recursive: true });

      // 从列表中移除
      this.installedModels.delete(modelId);
      await this.saveInstalledModels();

      console.log('模型卸载成功:', modelId);
      return true;
    } catch (error) {
      console.error('卸载模型失败:', error);
      return false;
    }
  }

  getModelPath(modelId: string): string | null {
    const installedModel = this.installedModels.get(modelId);
    return installedModel?.path || null;
  }
}

// 临时声明 app，实际应该从 electron 导入
declare const app: { getPath: (name: string) => string } | undefined;

