{
  description = "Wuling development and source-deployment tools";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in {
      devShells = forAllSystems (system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell {
            packages = with pkgs; [
              cargo rustc rustfmt clippy nodejs_24 pnpm git
              pkg-config cmake openssl libiconv protobuf
            ];
          };
        });
      apps = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          command = name: script: {
            type = "app";
            program = "${pkgs.writeShellScriptBin name ''
              set -eu
              test -f scripts/${script} || {
                echo "Run from the Wuling repository root" >&2
                exit 1
              }
              exec ${pkgs.nix}/bin/nix develop ${self} --command sh scripts/${script}
            ''}/bin/${name}";
          };
        in {
          dev = command "wuling-dev" "dev.sh";
          build = command "wuling-build" "build.sh";
          start = command "wuling-start" "start.sh";
          check = command "wuling-check" "check.sh";
        });
    };
}
