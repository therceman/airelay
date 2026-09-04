import { profileToYaml, profilesToYaml } from '../src/utils/yaml';
import { ProfileSchema } from '../src/config/schema';

describe('profileToYaml', () => {
  it('converts minimal profile to YAML', () => {
    const profile = ProfileSchema.parse({
      executable: 'opencode',
    });

    const yaml = profileToYaml('test', profile);
    expect(yaml).toContain('  test:');
    expect(yaml).toContain('executable: opencode');
  });

  it('includes cwd when present', () => {
    const profile = ProfileSchema.parse({
      executable: 'opencode',
      cwd: '~/test',
    });

    const yaml = profileToYaml('test', profile);
    expect(yaml).toContain('cwd: ~/test');
  });

  it('includes description when present', () => {
    const profile = ProfileSchema.parse({
      executable: 'opencode',
      description: 'Work profile',
    });

    const yaml = profileToYaml('test', profile);
    expect(yaml).toContain('description: Work profile');
  });

  it('includes args when present', () => {
    const profile = ProfileSchema.parse({
      executable: 'opencode',
      args: ['--verbose', '--sandbox'],
    });

    const yaml = profileToYaml('test', profile);
    expect(yaml).toContain('args:');
    expect(yaml).toContain('- --verbose');
    expect(yaml).toContain('- --sandbox');
  });

  it('includes env when present', () => {
    const profile = ProfileSchema.parse({
      executable: 'opencode',
      env: {
        TEST_VAR: 'value1',
        ANOTHER_VAR: 'value2',
      },
    });

    const yaml = profileToYaml('test', profile);
    expect(yaml).toContain('env:');
    expect(yaml).toContain('TEST_VAR: value1');
    expect(yaml).toContain('ANOTHER_VAR: value2');
  });

  it('includes createDirs when present', () => {
    const profile = ProfileSchema.parse({
      executable: 'opencode',
      createDirs: ['/tmp/dir1', '/tmp/dir2'],
    });

    const yaml = profileToYaml('test', profile);
    expect(yaml).toContain('createDirs:');
    expect(yaml).toContain('- /tmp/dir1');
    expect(yaml).toContain('- /tmp/dir2');
  });
});

describe('profilesToYaml', () => {
  it('converts multiple profiles to YAML', () => {
    const profiles: Record<string, ReturnType<typeof ProfileSchema.parse>> = {
      alpha: ProfileSchema.parse({
        executable: 'opencode',
      }),
      zebra: ProfileSchema.parse({
        executable: 'codex',
      }),
    };

    const yaml = profilesToYaml(profiles);
    expect(yaml).toContain('  alpha:');
    expect(yaml).toContain('  zebra:');
    expect(yaml).toContain('executable: opencode');
    expect(yaml).toContain('executable: codex');
  });
});
