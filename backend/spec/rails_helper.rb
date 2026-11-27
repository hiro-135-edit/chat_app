# spec/rails_helper.rb
require 'simplecov'
require 'simplecov-lcov'

coverage_directory = ENV.fetch('COVERAGE_DIR', 'coverage')
SimpleCov.coverage_dir coverage_directory

SimpleCov::Formatter::LcovFormatter.config do |c|
  c.output_directory = coverage_directory
  c.lcov_file_name = 'lcov.info'
  c.report_with_single_file = true
end

SimpleCov.formatter = SimpleCov::Formatter::LcovFormatter
SimpleCov.start 'rails' do
  enable_coverage :branch
  minimum_coverage line: 80
end

ENV['RAILS_ENV'] ||= 'test'
ENV['BFF_SHARED_TOKEN'] ||= 'test-bff-token'

require File.expand_path('../config/environment', __dir__)
abort('The Rails environment is running in production mode!') if Rails.env.production?

require 'spec_helper'
require 'rspec/rails'

# Rails がロードされてから Rails.root を使う
Dir[Rails.root.join('spec/support/**/*.rb')].each { |f| require f }

RSpec.configure do |config|
  config.use_transactional_fixtures = true
  config.infer_spec_type_from_file_location!
  config.filter_rails_from_backtrace!

  config.include Devise::Test::IntegrationHelpers, type: :request
end
