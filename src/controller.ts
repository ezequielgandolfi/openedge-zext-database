import * as vscode from 'vscode';
import * as fs from 'fs';
import * as util from 'util';
import { DbType } from '@oe-zext/types';

let _instance: Controller;

/**
 * Controls database definition data
 */
export class Controller {

    private readonly readFileAsync = util.promisify(fs.readFile);

    private dbfNamePattern:string;
    private dbfNameRegexp: RegExp;
    private onChangeEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter();
    private watcher: vscode.FileSystemWatcher;
    private dbfCollection: DbType.DbFile[] = [];

    static getInstance(): Controller {
        return _instance;
    }

    static attach(namePattern:string, nameRegexp:RegExp): Controller {
        _instance = new Controller();
        _instance.dbfNamePattern = namePattern;
        _instance.dbfNameRegexp = nameRegexp;
        _instance.startWatcher();
        process.nextTick(() => _instance.initDbFiles());
        return _instance;
    }

    dispose() {
        this.stopWatcher();
    }

    get onChange() {
        return this.onChangeEmitter.event;
    }

    getCollection(database?:string) {
        if (database)
            return this.dbfCollection.filter(item => item.database == database);
        return this.dbfCollection;
    }

    getTable(name: string): DbType.Table {
        name = name.toLowerCase();
        return this.dbfCollection.find(item => item.name.toLowerCase() == name);
    }

    private startWatcher() {
        this.watcher = vscode.workspace.createFileSystemWatcher(this.dbfNamePattern);
        this.watcher.onDidChange(uri => this.loadDbFile(uri.fsPath));
        this.watcher.onDidDelete(uri => this.unloadDbFile(uri.fsPath));
    }

    private stopWatcher() {
        this.watcher.dispose();
        this.watcher = null;
    }

    private initDbFiles() {
        vscode.workspace.findFiles(this.dbfNamePattern).then(files => files.forEach(file => this.loadDbFile(file.fsPath)));
    }

    private loadDbFile(filename: string) {
        if (filename) {
            this.unloadDbFile(filename);
            this.readFileAsync(filename, { encoding: 'utf8' }).then(text => {
                try {
                    let data:any[] = JSON.parse(text);
                    let dbName = this.getDbName(filename);
                    this.dbfCollection.push(...this.mapDbFile(dbName,data));
                    this.onChangeEmitter.fire(dbName);
                }
                catch {
                    console.log(`Can't load database file ${filename}`);
                }
            });
        }
    }

    private unloadDbFile(filename: string) {
        if (filename) {
            let dbName = this.getDbName(filename);
            this.dbfCollection = this.dbfCollection.filter(item => item.database != dbName);
            this.onChangeEmitter.fire(dbName);
        }
    }

    private mapDbFile(dbName:string,list:any[]): DbType.DbFile[] {
        return list.map(item => {
            let dbfile: DbType.DbFile = {
                database: dbName,
                name: item.label,
                description: item.detail,
                fields: [],
                indexes: []
            };
            dbfile.indexes = [...item.indexes.map(index => {
                return <DbType.Index>{
                    name: index.label,
                    isPK: index.primary,
                    isUnique: index.unique,
                    fields: index.fields.map(f => f.label)
                }
            })];
            dbfile.fields = [...item.fields.map(field => {
                return <DbType.Field>{
                    name: field.label,
                    description: field.detail,
                    type: field.dataType,
                    mandatory: field.mandatory,
                    format: field.format,
                    isPK: !!dbfile.indexes.filter(i => i.isPK).find(i => i.fields.includes(field.label)),
                    isKey: !!dbfile.indexes.find(i => i.fields.includes(field.label))
                }
            })];
            return dbfile;
        });
    }

    private getDbName(filename:string): string {
        if (this.dbfNameRegexp) {
            let match = filename.match(this.dbfNameRegexp);
            if (match) {
                return match[1].toLowerCase();
            }
        }
        return filename.toLowerCase();
    }

}
