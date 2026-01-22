export class LanguageRegistry {
  private static readonly EXTENSIONS: Record<string, string> = {
    yaml: 'yaml',
    json: 'json',
    markdown: 'md',
    javascript: 'js',
    typescript: 'ts',
    python: 'py',
    html: 'html',
    css: 'css',
    shell: 'sh',
    xml: 'xml',
    plaintext: 'txt'
  };

  static getExtension(language: string): string {
    return this.EXTENSIONS[language] || 'txt';
  }

  static getLanguage(extension: string): string {
    // Reverse lookup or default
    const entry = Object.entries(this.EXTENSIONS).find(([_, ext]) => ext === extension);
    return entry ? entry[0] : 'plaintext';
  }
}
