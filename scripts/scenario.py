#!/usr/bin/env python3
"""Real HTTP + Docker/SSH recovery scenario; never imports application internals."""
import argparse
import base64
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import urllib.error
import urllib.request


def private(path, content):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(content)


def prepare(root):
    (root / '.secrets').mkdir(mode=0o700)
    (root / 'imports').mkdir()
    (root / 'ssh-configs').mkdir()
    (root / 'data').mkdir()
    (root / 'imports' / 'nginx.conf').write_text('events {}\nhttp { server { listen 8080; proxy_read_timeout 60s; } }\n')
    (root / 'imports' / 'docker-compose.yml').write_text('services:\n  app:\n    image: nginx:alpine\n')
    (root / 'imports' / 'wg0.conf').write_text('[Interface]\nPrivateKey = ' + base64.b64encode(secrets.token_bytes(32)).decode() + '\nAddress = 10.20.0.1/24\nListenPort = 51820\n')
    (root / 'imports' / 'app.service').write_text('[Unit]\nDescription=Integration\n[Service]\nExecStart=/usr/bin/true\n[Install]\nWantedBy=multi-user.target\n')
    (root / 'ssh-configs' / 'app.json').write_text('{"port":8080,"mode":"initial"}\n')
    admin_password = 'integration-' + secrets.token_urlsafe(20)
    ssh_password = secrets.token_urlsafe(32)
    backup_password = secrets.token_urlsafe(32)
    private(root / '.secrets' / 'db_password', secrets.token_urlsafe(32))
    private(root / '.secrets' / 'vault_key', base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())
    private(root / '.secrets' / 'bootstrap.json', json.dumps({'username':'integration-admin','password':admin_password,'instance_name':'Recovery verification','timezone':'UTC'}))
    private(root / 'ssh_password', ssh_password)
    private(root / 'backup_password', backup_password)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    private(root / 'state.json', json.dumps({'port':port,'username':'integration-admin','password':admin_password,'checks':[]}))
    values = {'HTTP_PORT':str(port),'BIND_ADDRESS':'127.0.0.1','DATA_DIRECTORY':str(root/'data'),'LOCAL_IMPORT_DIRECTORY':str(root/'imports'),'SECRETS_DIRECTORY':str(root/'.secrets'),'TEST_DIRECTORY':str(root),'TZ':'UTC','COOKIE_SECURE':'false'}
    private(root / '.env', ''.join(f'{key}={json.dumps(value)}\n' for key,value in values.items()))


class API:
    def __init__(self, url):
        self.url = url
        self.csrf = ''
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, method, route, data=None, expected=200, raw=False):
        headers = {'Content-Type':'application/json','Origin':self.url}
        if self.csrf: headers['X-CSRF-Token'] = self.csrf
        body = json.dumps(data).encode() if data is not None else None
        request = urllib.request.Request(self.url + '/api' + route, data=body, method=method, headers=headers)
        try:
            response = self.opener.open(request, timeout=45)
            status = response.status
            content = response.read()
        except urllib.error.HTTPError as error:
            status = error.code
            content = error.read()
        if status != expected:
            # Only report error responses, never successful config/credential contents.
            raise AssertionError(f'{method} {route}: expected {expected}, got {status}: {content[:1000].decode(errors="replace")}')
        return content if raw else json.loads(content)

    def login(self, state):
        result = self.call('POST','/auth/login',{'username':state['username'],'password':state['password']})
        self.csrf = result['csrf']


def record(state, message):
    state['checks'].append(message)
    print('PASS ' + message, flush=True)


def seed(root, url, container):
    state = json.loads((root/'state.json').read_text())
    api = API(url)
    api.call('GET','/health')
    api.login(state)
    assert api.call('GET','/configs') == []
    record(state,'Empty installation and admin login')
    local = api.call('POST','/devices',{'name':'Debian local integration','type':'Server','connection':'local','os':'Debian','connection_data':{'roots':['/imports']}},201)
    local_files = ['/imports/nginx.conf','/imports/docker-compose.yml','/imports/wg0.conf','/imports/app.service']
    configs = api.call('POST',f'/devices/{local["id"]}/import',{'paths':local_files,'policy':'pull_only'})
    assert len(configs) == 4
    record(state,'Local import nginx, Compose, WireGuard and systemd')
    nginx = next(config for config in configs if config['name']=='nginx.conf')
    original = api.call('GET',f'/configs/{nginx["id"]}?reveal=true')['content']
    changed = original.replace('60s','120s')
    edited = api.call('PATCH',f'/configs/{nginx["id"]}',{'content':changed,'expected_version':1,'message':'Integration timeout change'})
    assert edited['version'] == 2
    diff = api.call('GET',f'/configs/{nginx["id"]}/diff?left=1&right=2')
    assert diff['left_content'] != diff['right_content'] and '120s' in diff['unified']
    restored = api.call('POST',f'/configs/{nginx["id"]}/restore',{'version':1,'expected_version':2})
    assert restored['version']==3 and api.call('GET',f'/configs/{nginx["id"]}?reveal=true')['content']==original
    record(state,'Version 2, real diff and non-destructive restore to version 3')
    snapshot = api.call('POST','/snapshots',{'name':'Before integration upgrade','device_id':local['id']},201)
    api.call('PATCH',f'/configs/{nginx["id"]}',{'content':changed,'expected_version':3,'message':'After snapshot'})
    api.call('POST',f'/snapshots/{snapshot["id"]}/restore',{'config_ids':[nginx['id']],'expected_versions':{str(nginx['id']):4}})
    assert api.call('GET',f'/configs/{nginx["id"]}?reveal=true')['content']==original
    record(state,'Snapshot creation and selected-file snapshot restore')
    ssh_data={'host':'ssh','port':22,'username':'root','roots':['/fixtures']}
    ssh = api.call('POST','/devices',{'name':'Debian 13 SSH integration','type':'Server','connection':'ssh','os':'Debian 13','connection_data':ssh_data},201)
    api.call('PUT',f'/devices/{ssh["id"]}/credential',{'password':(root/'ssh_password').read_text()})
    key = api.call('GET',f'/devices/{ssh["id"]}/host-key')
    ssh_data['host_key']=key['host_key']
    api.call('PATCH',f'/devices/{ssh["id"]}',{'connection_data':ssh_data})
    api.call('POST',f'/devices/{ssh["id"]}/test',{})
    remote = api.call('POST',f'/devices/{ssh["id"]}/import',{'paths':['/fixtures/app.json'],'policy':'push_pull'})[0]
    record(state,'Real Debian OpenSSH connection, host-key pinning and import')
    subprocess.run(['docker','exec',container,'sh','-c','printf \'{"port":8081,"mode":"external"}\\n\' > /fixtures/app.json'],check=True)
    synced = api.call('POST',f'/devices/{ssh["id"]}/sync',{})
    assert remote['id'] in synced['changes']
    current = api.call('GET',f'/configs/{remote["id"]}?reveal=true')
    assert current['version']==2
    api.call('PATCH',f'/configs/{remote["id"]}',{'content':'{"port":8082,"mode":"vault"}\n','expected_version':2})
    subprocess.run(['docker','exec',container,'sh','-c','printf \'{"port":8083,"mode":"remote-conflict"}\\n\' > /fixtures/app.json'],check=True)
    conflict = api.call('POST',f'/devices/{ssh["id"]}/sync',{})
    assert remote['id'] in conflict['conflicts']
    view = api.call('GET',f'/configs/{remote["id"]}/remote?reveal=true')
    assert view['conflict'] and '8083' in view['content']
    api.call('POST',f'/configs/{remote["id"]}/resolve',{'strategy':'remote','expected_version':3,'expected_remote_hash':view['hash']})
    assert '8083' in api.call('GET',f'/configs/{remote["id"]}?reveal=true')['content']
    record(state,'External SSH change, sync, conflict and explicit Keep Remote')
    current = api.call('GET',f'/configs/{remote["id"]}?reveal=true')
    next_content='{"port":8084,"mode":"applied"}\n'
    edited=api.call('PATCH',f'/configs/{remote["id"]}',{'content':next_content,'expected_version':current['version']})
    view=api.call('GET',f'/configs/{remote["id"]}/remote')
    api.call('POST',f'/configs/{remote["id"]}/apply',{'expected_version':edited['version'],'expected_remote_hash':view['hash']})
    assert '8084' in api.call('GET',f'/configs/{remote["id"]}/remote?reveal=true')['content']
    record(state,'Validated SSH Safe Apply writes the actual file')
    viewer_password='viewer-'+secrets.token_urlsafe(20)
    api.call('POST','/users',{'username':'integration-viewer','password':viewer_password,'role':'viewer','device_ids':[local['id']],'project_ids':[],'service_ids':[]},201)
    viewer=API(url); viewer.login({'username':'integration-viewer','password':viewer_password})
    assert all(config['device_id']==local['id'] for config in viewer.call('GET','/configs'))
    viewer.call('PATCH',f'/configs/{nginx["id"]}',{'content':changed,'expected_version':5},403)
    wg=next(config for config in configs if config['name']=='wg0.conf')
    masked=api.call('GET',f'/configs/{wg["id"]}')['content']
    raw=(root/'imports'/'wg0.conf').read_text().split('PrivateKey = ')[1].splitlines()[0]
    assert raw not in masked
    record(state,'Viewer RBAC and secret masking')
    state['ids']={'local':local['id'],'ssh':ssh['id'],'nginx':nginx['id'],'remote':remote['id'],'snapshot':snapshot['id']}
    state['expected']={'devices':len(api.call('GET','/devices')),'configs':len(api.call('GET','/configs')),'users':len(api.call('GET','/users')),'snapshots':len(api.call('GET','/snapshots')),'nginx_versions':len(api.call('GET',f'/configs/{nginx["id"]}/versions')),'remote_versions':len(api.call('GET',f'/configs/{remote["id"]}/versions')),'activity':len(api.call('GET','/activity'))}
    backup=api.call('POST','/backups',{'password':(root/'backup_password').read_text()},201)
    blob=api.call('GET',f'/backups/{backup["id"]}/download',raw=True)
    assert blob.startswith(b'CONFIGVAULT-BACKUP-1\n') and raw.encode() not in blob
    (root/'recovery.cvbackup').write_bytes(blob); os.chmod(root/'recovery.cvbackup',0o600)
    record(state,'Portable encrypted complete backup')
    (root/'.secrets'/'bootstrap.json').write_text('{}')
    (root/'state.json').write_text(json.dumps(state)); os.chmod(root/'state.json',0o600)


def verify(root,url):
    state=json.loads((root/'state.json').read_text()); api=API(url); api.login(state)
    for route,key in (('/devices','devices'),('/configs','configs'),('/users','users'),('/snapshots','snapshots')):
        assert len(api.call('GET',route))==state['expected'][key],key
    for identifier,key in (('nginx','nginx_versions'),('remote','remote_versions')):
        assert len(api.call('GET',f'/configs/{state["ids"][identifier]}/versions'))==state['expected'][key],key
    assert len(api.call('GET','/activity'))>=state['expected']['activity']
    assert '8084' in api.call('GET',f'/configs/{state["ids"]["remote"]}?reveal=true')['content']
    record(state,'With a new encryption key after deleting test DB and vault: devices, configs, versions, snapshots, users and activity recovered')
    api.call('POST',f'/devices/{state["ids"]["ssh"]}/test',{})
    record(state,'Encrypted SSH credentials remain usable after recovery')
    report={'passed':True,'checks':state['checks'],'counts':state['expected']}
    (root/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('stage',choices=('prepare','port','seed','verify','rekey')); parser.add_argument('directory'); parser.add_argument('url',nargs='?'); parser.add_argument('container',nargs='?'); args=parser.parse_args()
    root=Path(args.directory).resolve()
    if args.stage=='prepare': prepare(root)
    elif args.stage=='rekey':
        assert (root/'.config-vault-test-sentinel').is_file() and (root/'recovery.cvbackup').is_file()
        (root/'.secrets'/'vault_key').write_text(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())
        os.chmod(root/'.secrets'/'vault_key',0o600)
    elif args.stage=='port': print(json.loads((root/'state.json').read_text())['port'])
    elif args.stage=='seed': seed(root,args.url,args.container)
    else: verify(root,args.url)


if __name__=='__main__': main()
