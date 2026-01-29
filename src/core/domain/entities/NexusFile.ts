import { LanguageRegistry } from '../services/LanguageRegistry';
import { calculateChecksum } from '../shared/Hash';

export class NexusFile {
  constructor(
    public readonly id: string,
    public title: string,
    public content: string,
    public language: string,
    public tags: string[] = [],
    public updatedAt: string = new Date().toISOString(),
    public isDirty: boolean = false,
    public checksum: string = '',
    public lastSyncedAt: string | null = null,
    public isSecure: boolean = false
  ) {}

  /**
   * 计算对应的 Gist 文件名 (e.g. "id.ext")
   */
  get filename(): string {
    const ext = LanguageRegistry.getExtension(this.language);
    return `${this.id}.${ext}`;
  }

  updateContent(newContent: string): void {
    if (this.content !== newContent) {
      this.content = newContent;
      this.checksum = calculateChecksum(newContent);
      this.updatedAt = new Date().toISOString();
      this.isDirty = true;
    }
  }

  markSynced(remoteUpdatedAt: string): void {
    this.isDirty = false;
    this.lastSyncedAt = remoteUpdatedAt;
  }

  changeLanguage(newLang: string): void {
    if (this.language !== newLang) {
      this.language = newLang;
      this.updatedAt = new Date().toISOString();
      // Filename changes implicitly via getter, but Gist sync needs to handle rename
      this.isDirty = true; 
    }
  }

  markClean(): void {
    this.isDirty = false;
  }
}
