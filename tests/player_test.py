import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('agent', Path(__file__).parents[1] / 'player' / 'agent.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PlayerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = {'server': 'http://localhost:3100', 'name': 'Test screen'}
        self.agent = module.Agent(self.config, self.tmp.name)
        self.agent.credentials = {'token': 'test-token', 'server': self.config['server']}

    def response(self, revision='one', assets=None, command=None):
        return {'approved': True, 'blank': False, 'rotation': 0, 'manifest': {'schemaVersion': 1, 'revision': revision, 'items': [], 'assets': assets or []}, 'command': command}

    def test_complete_manifest_survives_offline_restart(self):
        with patch.object(self.agent, 'request', return_value=self.response()):
            self.agent.sync()
        restarted = module.Agent(self.config, self.tmp.name)
        self.assertEqual(restarted.state['manifest']['revision'], 'one')

        with patch.object(restarted, 'request', side_effect=OSError('Offline')):
            with self.assertRaises(OSError):
                restarted.sync()
        self.assertEqual(restarted.state['manifest']['revision'], 'one')

    def test_weather_persists_offline_and_retains_last_snapshot_for_assigned_locations(self):
        weather = {'41.8781,-87.6298': {'status': 'ready', 'fetchedAt': '2026-09-16T12:00:00Z', 'periods': [{'temperatureF': 72}]}}
        with patch.object(self.agent, 'request', return_value={**self.response(), 'weather': weather}):
            self.agent.sync()
        restarted = module.Agent(self.config, self.tmp.name)
        self.assertEqual(restarted.state['weather'], weather)
        with patch.object(self.agent, 'request', return_value={**self.response(), 'weather': {'41.8781,-87.6298': {'status': 'loading', 'periods': []}}}):
            self.agent.sync()
        self.assertEqual(self.agent.state['weather']['41.8781,-87.6298']['periods'], weather['41.8781,-87.6298']['periods'])
        self.assertEqual(self.agent.state['weather']['41.8781,-87.6298']['status'], 'stale')
        with patch.object(self.agent, 'request', return_value={**self.response(), 'weather': {}}):
            self.agent.sync()
        self.assertEqual(self.agent.state['weather'], {})
        with patch.object(restarted, 'request', side_effect=OSError('Offline')):
            with self.assertRaises(OSError):
                restarted.sync()
        self.assertEqual(restarted.state['weather'], weather)

    def test_disconnect_retains_cache_and_retries_at_fifteen_second_cadence(self):
        with patch.object(self.agent, 'request', return_value=self.response()):
            self.agent.sync()
        self.assertTrue(self.agent.connected)
        with patch.object(self.agent, 'sync', side_effect=OSError('Offline')), patch.object(module.time, 'monotonic', side_effect=[100, 110]), patch.object(module.time, 'sleep', side_effect=StopIteration) as sleep:
            with self.assertRaises(StopIteration):
                self.agent.loop()
        sleep.assert_called_once_with(5)
        self.assertFalse(self.agent.connected)
        self.assertEqual(self.agent.state['manifest']['revision'], 'one')
        with patch.object(self.agent, 'request', return_value=self.response()):
            self.agent.sync()
        self.assertTrue(self.agent.connected)
        restarted = module.Agent(self.config, self.tmp.name)
        self.assertFalse(restarted.connected)

    def test_recovery_credentials_are_cached_separately_from_playback_state(self):
        player_id = '12345678-1234-1234-1234-123456789abc'
        self.agent.credentials['id'] = player_id
        self.agent.state = self.response()
        value = dict(playerId=player_id, ssid=player_id.replace('-', ''), password='a' * 24, hidden=True)
        with patch.object(self.agent, 'request', return_value=value) as request:
            self.agent.ensure_recovery()
            self.agent.recovery_next = 0
            self.agent.ensure_recovery()
        self.assertEqual(request.call_count, 1)
        self.assertNotIn(value['password'], json.dumps(self.agent.state))
        self.assertEqual(json.loads((self.agent.cache / 'recovery.json').read_text())['password'], value['password'])
    def test_failed_download_does_not_replace_last_good_manifest(self):
        with patch.object(self.agent, 'request', return_value=self.response()):
            self.agent.sync()
        with patch.object(self.agent, 'request', return_value=self.response('two', [{'id': 'image'}])), patch.object(self.agent, 'download', side_effect=OSError('Incomplete')):
            with self.assertRaises(OSError):
                self.agent.sync()
        state = json.loads((Path(self.tmp.name) / 'state.json').read_text())
        self.assertEqual(state['manifest']['revision'], 'one')

    def test_refresh_command_is_durable_and_not_repeated(self):
        command = {'id': 'command-one', 'type': 'refresh'}
        with patch.object(self.agent, 'request', side_effect=lambda *args: self.response(command=command.copy())):
            self.agent.sync()
            self.agent.sync()
        self.assertEqual(self.agent.state['generation'], 1)
        restarted = module.Agent(self.config, self.tmp.name)
        self.assertEqual(restarted.state['commandAck'], 'command-one')

    def test_asset_url_cannot_escape_server_media_path(self):
        with self.assertRaises(ValueError):
            self.agent.download({'filename': '../../identity.json', 'url': 'http://other.example'})

    def test_valid_cached_image_skips_network(self):
        name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'
        data = b'cached image bytes'
        (Path(self.tmp.name) / 'media' / name).write_bytes(data)
        asset = {'filename': name, 'url': '/media/' + name, 'sha256': hashlib.sha256(data).hexdigest()}
        with patch.object(self.agent.opener, 'open', side_effect=AssertionError('Unexpected download')):
            self.agent.download(asset)

    def test_cloudflare_access_headers_accompany_sync_and_media_without_replacing_device_token(self):
        config = {'server': 'https://openframe.example.com', 'cloudflare_access': {'client_id': 'test-client.access', 'client_secret': 'test-secret'}}
        agent = module.Agent(config, Path(self.tmp.name) / 'cloudflare')
        agent.credentials = {'token': 'device-token', 'server': config['server']}
        data = b'image data'
        asset = {'filename': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp', 'url': '/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp', 'sha256': hashlib.sha256(data).hexdigest()}
        with patch.object(agent.opener, 'open', side_effect=[io.BytesIO(b'{"approved":true}'), io.BytesIO(data)]) as open_request:
            agent.request('/api/player/sync', {})
            agent.download(asset)
        for call in open_request.call_args_list:
            request = call.args[0]
            headers = {k.lower(): v for k, v in request.header_items()}
            self.assertEqual(headers['cf-access-client-id'], 'test-client.access')
            self.assertEqual(headers['cf-access-client-secret'], 'test-secret')
            self.assertEqual(headers['authorization'], 'Bearer device-token')
            self.assertTrue(request.full_url.startswith('https://openframe.example.com/'))

    def test_cloudflare_credentials_require_https_complete_fields_and_safe_header_values(self):
        for config in (
            {'server': 'http://openframe.example.com', 'cloudflare_access': {'client_id': 'id', 'client_secret': 'secret'}},
            {'server': 'https://openframe.example.com', 'cloudflare_access': {'client_id': 'id'}},
            {'server': 'https://openframe.example.com', 'cloudflare_access': {'client_id': 'id', 'client_secret': 'secret\r\nInjected: header'}},
            {'server': 'https://openframe.example.com', 'cloudflare_access': {'client_id': 'id', 'client_secret': ''}},
        ):
            with self.subTest(config=config):
                with self.assertRaises(ValueError):
                    module.connection_settings(config)
        self.assertEqual(module.connection_settings({'server': 'http://192.168.1.10:3100/'})[0], 'http://192.168.1.10:3100')
        for address in ('https://user:password@example.com', 'https://example.com/subpath', 'https://example.com:0', 'https://example.com?token=secret', ' https://example.com'):
            with self.assertRaises(ValueError):
                module.normalize_server(address)

    def test_connection_check_uses_access_auth_but_does_not_enroll_or_expose_secrets(self):
        config = {'server': 'https://openframe.example.com', 'cloudflare_access': {'client_id': 'test-client', 'client_secret': 'test-secret'}}
        with patch.object(module.urllib.request, 'build_opener') as builder:
            builder.return_value.open.return_value = io.BytesIO(b'{"ok":true,"version":"0.1.0"}')
            result = module.check_connection(config)
            request = builder.return_value.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://openframe.example.com/api/health')
        headers = {k.lower(): v for k, v in request.header_items()}
        self.assertEqual(headers['cf-access-client-secret'], 'test-secret')
        self.assertNotIn('authorization', headers)
        self.assertTrue(result['reachable'])
        self.assertNotIn('test-secret', json.dumps(result))
        self.assertFalse((Path(self.tmp.name) / 'identity.json').exists())
        with patch.object(module.urllib.request, 'build_opener') as builder:
            builder.return_value.open.return_value = io.BytesIO(b'{"ok":false}')
            with self.assertRaisesRegex(ValueError, 'OpenFrame health'):
                module.check_connection(config)

    def test_cross_origin_and_https_downgrade_redirects_cannot_forward_secrets(self):
        handler = module.SameOriginRedirects()
        request = module.urllib.request.Request('https://openframe.example.com/api/player/sync', headers={'Authorization': 'Bearer private-token', 'CF-Access-Client-Secret': 'private-access-secret'})
        for url in ('https://other.example/api/player/sync', 'http://openframe.example.com/api/player/sync', 'https://openframe.example.com:8443/api/player/sync', 'https://user:pass@openframe.example.com/api/player/sync'):
            with self.assertRaises(ValueError):
                handler.redirect_request(request, None, 302, 'Moved', {}, url)
        redirected = handler.redirect_request(request, None, 302, 'Moved', {}, 'https://openframe.example.com:443/new-path')
        self.assertEqual(redirected.full_url, 'https://openframe.example.com:443/new-path')

    def test_proxy_401_keeps_cache_and_identity_but_openframe_revocation_clears_them(self):
        for body, revoked in ((b'<html>Cloudflare Access denied</html>', False), (b'{"error":"Access denied"}', False), (b'{"code":"DEVICE_CREDENTIALS_INVALID"}', True), (b'{"error":"Device credentials invalid"}', True)):
            self.agent.credentials = {'token': 'test-token', 'server': self.config['server']}
            with patch.object(self.agent, 'request', return_value=self.response()):
                self.agent.sync()
            error = module.urllib.error.HTTPError(self.config['server'] + '/api/player/sync', 401, 'Unauthorized', {}, io.BytesIO(body))
            with patch.object(self.agent, 'sync', side_effect=error), patch.object(module.time, 'sleep', side_effect=StopIteration):
                with self.assertRaises(StopIteration):
                    self.agent.loop()
            self.assertEqual(not bool(self.agent.credentials), revoked)
            self.assertEqual(self.agent.state['approved'], not revoked)

    def test_changing_server_does_not_reuse_cached_approval(self):
        with patch.object(self.agent, 'request', return_value=self.response()):
            self.agent.sync()
        switched = module.Agent({'server': 'http://other-server:3100'}, self.tmp.name)
        self.assertFalse(switched.state['approved'])
        self.assertEqual(switched.credentials, {})

    def test_reboot_requires_explicit_local_capability(self):
        with patch.object(self.agent, 'request', return_value=self.response(command={'id': 'reboot-one', 'type': 'reboot'})), patch.object(module.subprocess, 'run') as run:
            self.agent.sync()
        run.assert_not_called()
        self.assertIn('Reboot disabled', self.agent.error)

    def test_unchanged_publication_does_not_reread_images_on_each_heartbeat(self):
        asset = {'id': 'one', 'filename': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'}
        with patch.object(self.agent, 'request', side_effect=lambda *args: self.response(assets=[asset.copy()])), patch.object(self.agent, 'download') as download:
            self.agent.sync()
            self.agent.sync()
        self.assertEqual(download.call_count, 1)

    def test_player_serves_shared_text_layout_but_not_private_files(self):
        server = module.http.server.ThreadingHTTPServer(('127.0.0.1', 0), self.agent.handler())
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = 'http://127.0.0.1:' + str(server.server_port)
            for filename in ('text-layout.js', 'counter.js', 'image-layout.js', 'playback.js', 'frame.js', 'widgets.js'):
                with module.urllib.request.urlopen(base + '/' + filename) as response:
                    self.assertEqual(response.headers.get('Content-Type'), 'text/javascript')
                    self.assertTrue(response.read())
            with self.assertRaises(module.urllib.error.HTTPError) as error:
                module.urllib.request.urlopen(base + '/identity.json')
            self.assertEqual(error.exception.code, 404)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_playback_status_is_validated_locally_and_forwarded_on_sync(self):
        server = module.http.server.ThreadingHTTPServer(('127.0.0.1', 0), self.agent.handler())
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = 'http://127.0.0.1:' + str(server.server_port)
            status = {'phase': 'waiting', 'preparationMs': 250, 'missedDeadlines': 2, 'slideId': 'slide', 'error': 'Late content'}
            def post(value, headers=None):
                request = module.urllib.request.Request(base + '/local/playback', data=json.dumps(value).encode(), headers={'Content-Type': 'application/json', **(headers or {})})
                return module.urllib.request.urlopen(request)
            with post(status, {'Origin': base}) as response:
                self.assertEqual(response.status, 204)
            with patch.object(self.agent, 'request', return_value=self.response()) as request:
                self.agent.sync()
                self.assertEqual(request.call_args.args[1]['playback'], status)
            for invalid in ({'phase': 'fake'}, {'phase': 'playing', 'missedDeadlines': -1}, [], {'phase': 'playing', 'preparationMs': float('nan')}):
                with self.assertRaises(module.urllib.error.HTTPError) as error:
                    post(invalid)
                self.assertEqual(error.exception.code, 400)
            for headers in ({'Origin': 'http://attacker.example'}, {'Host': 'attacker.example'}):
                with self.assertRaises(module.urllib.error.HTTPError) as error:
                    post(status, headers)
                self.assertEqual(error.exception.code, 403)
            self.assertEqual(self.agent.playback, status)
            self.agent.playback_at = module.time.monotonic() - 31
            with patch.object(self.agent, 'request', return_value=self.response()) as request:
                self.agent.sync()
                self.assertEqual(request.call_args.args[1]['playback']['phase'], 'stalled')
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_local_images_are_streamed_with_immutable_cache_headers(self):
        filename = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'
        data = b'image-content' * 20000
        (Path(self.tmp.name) / 'media' / filename).write_bytes(data)
        server = module.http.server.ThreadingHTTPServer(('127.0.0.1', 0), self.agent.handler())
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = 'http://127.0.0.1:' + str(server.server_port)
            with module.urllib.request.urlopen(base + '/media/' + filename) as response:
                self.assertEqual(int(response.headers.get('Content-Length')), len(data))
                self.assertIn('immutable', response.headers.get('Cache-Control'))
                self.assertEqual(response.read(), data)
            with module.urllib.request.urlopen(base + '/local/state') as response:
                self.assertEqual(response.headers.get('Cache-Control'), 'no-store')
            for script in ('weather.js', 'clock.js'):
                with module.urllib.request.urlopen(base + '/' + script) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn(b'export', response.read())
            request = module.urllib.request.Request(base + '/local/state', headers={'Host': 'attacker.example'})
            with self.assertRaises(module.urllib.error.HTTPError) as error:
                module.urllib.request.urlopen(request)
            self.assertEqual(error.exception.code, 403)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
